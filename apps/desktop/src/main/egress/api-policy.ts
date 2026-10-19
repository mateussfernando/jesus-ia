import { z } from 'zod';
import { API_BASE_URL, BRAIN_KEY_PLACEHOLDER, BRAIN_MODEL_ID, MAX_API_BODY_BYTES } from '../../bridge/brain-protocol';

/**
 * O que o Cérebro pode pedir à API da Anthropic (decisão 0023). O principal confere cada pedido antes de pôr a chave:
 * destino fixo, cabeçalhos em lista e corpo em lista branca (Zod estrito). Campo desconhecido, ferramenta de servidor
 * (busca na web, execução de código, MCP), fonte por URL, outro modelo ou `max_tokens` acima do teto: o pedido é
 * recusado, nunca "consertado".
 *
 * O corpo que sai é o objeto conferido, serializado de novo. Assim, um JSON com chave repetida (`"model"` duas vezes)
 * não leva um valor à conferência e outro à API: o `JSON.parse` fica com o último, e só ele sai.
 */

export const API_PATH = '/v1/messages';
export const API_URL = `${API_BASE_URL}/messages`;
export const ANTHROPIC_VERSION = '2023-06-01';
export const BRAIN_MODEL_KEY = `anthropic:${BRAIN_MODEL_ID}`;
/** Teto de `max_tokens` de um pedido (o raciocínio conta como saída). */
export const MAX_OUTPUT_TOKENS = 32_000;

/**
 * Betas aceitos (lista fechada). Só os que o provedor do AI SDK pede para o que o Jesus usa:
 * - `mid-conversation-system-2026-04-07`: mensagem de sistema no meio da conversa (`allowSystemInMessages`);
 * - `structured-outputs-2025-11-13`: o provedor pede sempre que há ferramenta própria.
 */
export const ALLOWED_BETAS: readonly string[] = ['mid-conversation-system-2026-04-07', 'structured-outputs-2025-11-13'];

/** Ferramentas próprias que o modelo pode chamar, pelo nome da API. As primeiras entram na etapa 13. */
export const PHASE1_TOOL_NAMES: readonly string[] = [];

/** Cabeçalhos que o Cérebro pode mandar. O principal monta os de saída do zero; estes só são conferidos. */
const REQUEST_HEADERS: ReadonlySet<string> = new Set(['content-type', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'user-agent']);

const MAX_MESSAGES = 10_000;
const MAX_BLOCKS = 1_000;
const MAX_TOOLS = 16;
const MAX_ID = 256;

export type ApiRefusal =
  | 'url'
  | 'method'
  | 'header'
  | 'content_type'
  | 'version'
  | 'beta'
  | 'key_in_brain'
  | 'body_size'
  | 'json'
  | 'body';

export interface ApiRequestInput {
  readonly url: string;
  readonly method: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

export interface CheckedApiRequest {
  /** O corpo conferido, serializado de novo: é ele que sai. */
  readonly body: string;
  readonly bodyBytes: number;
  readonly betas: readonly string[];
  readonly maxTokens: number;
  readonly messages: number;
  readonly tools: number;
}

export type ApiCheck =
  | { readonly ok: true; readonly request: CheckedApiRequest }
  | { readonly ok: false; readonly refusal: ApiRefusal; readonly detail: string };

export interface ApiPolicyOptions {
  /** Nomes das ferramentas próprias aceitas (em produção, `PHASE1_TOOL_NAMES`). */
  readonly toolNames: readonly string[];
}

const refuse = (refusal: ApiRefusal, detail: string): ApiCheck => ({ ok: false, refusal, detail: detail.slice(0, 300) });

// Só o cache de 5 min (o de 1 h custa o dobro na gravação, e a reserva do pior caso conta com o de 5 min).
const CacheControl = z.strictObject({ type: z.literal('ephemeral') });
const longText = z.string().max(MAX_API_BODY_BYTES);
const id = z.string().min(1).max(MAX_ID);

const TextBlock = z.strictObject({ type: z.literal('text'), text: longText, cache_control: CacheControl.optional() });
/** Raciocínio de uma resposta anterior, devolvido sem mudança (a assinatura vale para o modelo que o escreveu). */
const ThinkingBlock = z.strictObject({
  type: z.literal('thinking'),
  thinking: longText,
  signature: longText,
  cache_control: CacheControl.optional(),
});
const RedactedThinkingBlock = z.strictObject({
  type: z.literal('redacted_thinking'),
  data: longText,
  cache_control: CacheControl.optional(),
});

function bodySchema(toolNames: readonly string[]) {
  const toolName = z.string().refine((name) => toolNames.includes(name), 'ferramenta fora da lista');
  const ToolUseBlock = z.strictObject({
    type: z.literal('tool_use'),
    id,
    name: toolName,
    input: z.record(z.string(), z.unknown()),
    cache_control: CacheControl.optional(),
  });
  const ToolResultBlock = z.strictObject({
    type: z.literal('tool_result'),
    tool_use_id: id,
    // Só texto: imagem ou documento no resultado (e fonte por URL) ficam de fora.
    content: z.union([longText, z.array(TextBlock).max(MAX_BLOCKS)]).optional(),
    is_error: z.boolean().optional(),
    cache_control: CacheControl.optional(),
  });
  const UserMessage = z.strictObject({
    role: z.literal('user'),
    content: z.union([longText, z.array(z.discriminatedUnion('type', [TextBlock, ToolResultBlock])).min(1).max(MAX_BLOCKS)]),
  });
  const AssistantMessage = z.strictObject({
    role: z.literal('assistant'),
    content: z.union([
      longText,
      z.array(z.discriminatedUnion('type', [TextBlock, ThinkingBlock, RedactedThinkingBlock, ToolUseBlock])).min(1).max(MAX_BLOCKS),
    ]),
  });
  /** Instrução do próprio Jesus no meio da conversa (nunca conteúdo de fora). */
  const SystemMessage = z.strictObject({ role: z.literal('system'), content: z.array(TextBlock).min(1).max(MAX_BLOCKS) });
  const Tool = z.strictObject({
    name: toolName,
    description: z.string().max(4_096),
    input_schema: z.record(z.string(), z.unknown()),
    eager_input_streaming: z.boolean().optional(),
    strict: z.boolean().optional(),
    cache_control: CacheControl.optional(),
  });
  return z.strictObject({
    model: z.literal(BRAIN_MODEL_ID),
    max_tokens: z.int().min(1).max(MAX_OUTPUT_TOKENS),
    stream: z.literal(true),
    system: z.union([longText, z.array(TextBlock).min(1).max(MAX_BLOCKS)]).optional(),
    messages: z
      .array(z.discriminatedUnion('role', [UserMessage, AssistantMessage, SystemMessage]))
      .min(1)
      .max(MAX_MESSAGES),
    thinking: z.strictObject({ type: z.literal('adaptive'), display: z.enum(['summarized', 'omitted']).optional() }).optional(),
    output_config: z.strictObject({ effort: z.enum(['low', 'medium', 'high']) }).optional(),
    tools: z.array(Tool).max(MAX_TOOLS).optional(),
    tool_choice: z
      .strictObject({ type: z.enum(['auto', 'none']), disable_parallel_tool_use: z.boolean().optional() })
      .optional(),
  });
}

/** Onde o corpo saiu da lista: o caminho e o tipo do problema, sem valores (que podem ser conteúdo do usuário). */
function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (issue === undefined) return 'corpo inválido';
  const path = issue.path.map((part) => (typeof part === 'symbol' ? '?' : String(part).slice(0, 40))).join('.');
  const keys = issue.code === 'unrecognized_keys' ? ` (${issue.keys.map((key) => key.slice(0, 40)).join(', ')})` : '';
  return `${path === '' ? '(raiz)' : path}: ${issue.code}${keys}`;
}

/** Os betas de um cabeçalho `anthropic-beta`, ou `null` se algum estiver fora da lista (ou repetido). */
function parseBetas(value: string): string[] | null {
  const betas = value.split(',').map((beta) => beta.trim());
  if (betas.some((beta) => !ALLOWED_BETAS.includes(beta))) return null;
  return new Set(betas).size === betas.length ? betas : null;
}

export function checkApiRequest(input: ApiRequestInput, options: ApiPolicyOptions): ApiCheck {
  if (input.url !== API_URL) return refuse('url', 'destino fora da lista');
  if (input.method !== 'POST') return refuse('method', input.method);

  const seen = new Set<string>();
  let betas: string[] = [];
  for (const [rawName, value] of input.headers) {
    const name = rawName.toLowerCase();
    if (!REQUEST_HEADERS.has(name) || seen.has(name)) return refuse('header', name);
    seen.add(name);
    if (name === 'content-type' && value !== 'application/json') return refuse('content_type', value);
    if (name === 'anthropic-version' && value !== ANTHROPIC_VERSION) return refuse('version', value);
    // Uma chave de verdade no Cérebro é um problema por si só: ele nunca deveria ter uma.
    if (name === 'x-api-key' && value !== BRAIN_KEY_PLACEHOLDER) return refuse('key_in_brain', 'chave diferente da do Cérebro');
    if (name === 'anthropic-beta') {
      const parsed = parseBetas(value);
      if (parsed === null) return refuse('beta', value);
      betas = parsed;
    }
  }

  const bodyBytes = Buffer.byteLength(input.body, 'utf8');
  if (bodyBytes > MAX_API_BODY_BYTES) return refuse('body_size', String(bodyBytes));
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return refuse('json', 'corpo não é JSON');
  }
  const result = bodySchema(options.toolNames).safeParse(parsed);
  if (!result.success) return refuse('body', describeIssue(result.error.issues[0]));

  // O que sai é o resultado do `JSON.parse` (já conferido inteiro pelo esquema estrito), na ordem em que veio.
  const body = JSON.stringify(parsed);
  return {
    ok: true,
    request: {
      body,
      bodyBytes: Buffer.byteLength(body, 'utf8'),
      betas,
      maxTokens: result.data.max_tokens,
      messages: result.data.messages.length,
      tools: result.data.tools?.length ?? 0,
    },
  };
}
