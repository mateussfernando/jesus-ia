import { describe, expect, it } from 'vitest';
import { BRAIN_KEY_PLACEHOLDER, MAX_API_BODY_BYTES } from '../../bridge/brain-protocol';
import { API_URL, checkApiRequest, MAX_OUTPUT_TOKENS } from './api-policy';
import type { ApiRequestInput } from './api-policy';

const TOOLS = { toolNames: ['file_read'] };

/** O corpo que o AI SDK 7 monta para o Jesus (capturado do `streamText` com o provedor da Anthropic). */
function aiSdkBody(): Record<string, unknown> {
  return {
    model: 'claude-haiku-5-5',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Você é o Jesus.', cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Oi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'Olá' },
          { type: 'tool_use', id: 'toolu_1', name: 'file_read', input: { path: 'a.txt' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'conteúdo' }] },
          { type: 'text', text: 'Tudo bem?', cache_control: { type: 'ephemeral' } },
        ],
      },
      { role: 'system', content: [{ type: 'text', text: 'lembrete' }] },
    ],
    tools: [
      {
        name: 'file_read',
        description: 'Lê um arquivo.',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
        eager_input_streaming: true,
      },
    ],
    tool_choice: { type: 'auto' },
    stream: true,
  };
}

const HEADERS: [string, string][] = [
  ['anthropic-beta', 'mid-conversation-system-2026-04-07,structured-outputs-2025-11-13'],
  ['anthropic-version', '2023-06-01'],
  ['content-type', 'application/json'],
  ['user-agent', 'ai-sdk-anthropic/4.0.81 ai-sdk-provider-utils/5.0.61 node.js/24'],
  ['x-api-key', BRAIN_KEY_PLACEHOLDER],
];

function request(overrides: Partial<ApiRequestInput> & { bodyObject?: Record<string, unknown> } = {}): ApiRequestInput {
  const { bodyObject, ...rest } = overrides;
  return { url: API_URL, method: 'POST', headers: HEADERS, body: JSON.stringify(bodyObject ?? aiSdkBody()), ...rest };
}

function withBody(change: (body: Record<string, unknown>) => void): ApiRequestInput {
  const body = aiSdkBody();
  change(body);
  return request({ bodyObject: body });
}

function refusal(input: ApiRequestInput, options = TOOLS) {
  const result = checkApiRequest(input, options);
  return result.ok ? null : result.refusal;
}

describe('checkApiRequest: o que passa', () => {
  it('aceita o pedido que o AI SDK monta e devolve o corpo conferido, serializado de novo', () => {
    const input = request({ body: JSON.stringify(aiSdkBody(), null, 2) });
    const result = checkApiRequest(input, TOOLS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.body).toBe(JSON.stringify(aiSdkBody()));
    expect(result.request.bodyBytes).toBe(Buffer.byteLength(result.request.body));
    expect(result.request.betas).toEqual(['mid-conversation-system-2026-04-07', 'structured-outputs-2025-11-13']);
    expect(result.request.maxTokens).toBe(4096);
    expect(result.request.messages).toBe(4);
    expect(result.request.tools).toBe(1);
  });

  it('aceita o pedido mínimo, sem betas nem chave de mentira', () => {
    const body = { model: 'claude-haiku-5-5', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'oi' }] };
    const result = checkApiRequest(
      { url: API_URL, method: 'POST', headers: [['content-type', 'application/json']], body: JSON.stringify(body) },
      { toolNames: [] },
    );
    expect(result.ok && result.request.betas).toEqual([]);
  });

  it('com chave repetida no JSON, sai só o valor que foi conferido (o último)', () => {
    const body = JSON.stringify(aiSdkBody()).replace('"model":"claude-haiku-5-5"', '"model":"claude-opus-5-5","model":"claude-haiku-5-5"');
    expect(body).toContain('claude-opus-5-5');
    const result = checkApiRequest(request({ body }), TOOLS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.body).not.toContain('claude-opus-5-5');
  });
});

describe('checkApiRequest: destino, método e cabeçalhos', () => {
  it.each([
    'http://api.anthropic.com/v1/messages',
    'https://api.anthropic.com/v1/messages?beta=true',
    'https://api.anthropic.com/v1/messages/batches',
    'https://api.anthropic.com/v1/files',
    'https://api.anthropic.com.atacante.example/v1/messages',
    'https://ai-gateway.vercel.sh/v4/ai/messages',
    'https://API.ANTHROPIC.COM/v1/messages',
  ])('recusa o destino %s', (url) => {
    expect(refusal(request({ url }))).toBe('url');
  });

  it('recusa outro método', () => {
    expect(refusal(request({ method: 'GET' }))).toBe('method');
    expect(refusal(request({ method: 'post' }))).toBe('method');
  });

  it.each([['authorization', 'Bearer x'], ['x-forwarded-for', '1.2.3.4'], ['anthropic-dangerous-direct-browser-access', 'true'], ['host', 'x']])(
    'recusa o cabeçalho %s',
    (name, value) => {
      expect(refusal(request({ headers: [...HEADERS, [name, value]] }))).toBe('header');
    },
  );

  it('recusa cabeçalho repetido (também com outra grafia)', () => {
    expect(refusal(request({ headers: [...HEADERS, ['Content-Type', 'application/json']] }))).toBe('header');
  });

  it('recusa outro tipo de conteúdo e outra versão da API', () => {
    const swap = (name: string, value: string) => HEADERS.map(([n, v]): [string, string] => (n === name ? [n, value] : [n, v]));
    expect(refusal(request({ headers: swap('content-type', 'text/plain') }))).toBe('content_type');
    expect(refusal(request({ headers: swap('anthropic-version', '2025-01-01') }))).toBe('version');
  });

  it.each(['mcp-client-2025-04-04', 'files-api-2025-04-14', 'server-side-fallback-2026-07-01', 'structured-outputs-2025-11-13,structured-outputs-2025-11-13'])(
    'recusa o beta %s',
    (beta) => {
      const headers = HEADERS.map(([n, v]): [string, string] => (n === 'anthropic-beta' ? [n, beta] : [n, v]));
      expect(refusal(request({ headers }))).toBe('beta');
    },
  );

  it('uma chave de verdade vinda do Cérebro é recusada (ele nunca deveria ter uma)', () => {
    const headers = HEADERS.map(([n, v]): [string, string] => (n === 'x-api-key' ? [n, 'sk-ant-api03-chave'] : [n, v]));
    expect(refusal(request({ headers }))).toBe('key_in_brain');
  });
});

describe('checkApiRequest: corpo', () => {
  it('recusa corpo grande demais e corpo que não é JSON', () => {
    expect(refusal(request({ body: 'x'.repeat(MAX_API_BODY_BYTES + 1) }))).toBe('body_size');
    expect(refusal(request({ body: '{"model":' }))).toBe('json');
  });

  it('recusa outro modelo', () => {
    expect(refusal(withBody((b) => (b['model'] = 'claude-opus-5-5')))).toBe('body');
  });

  it.each([0, -1, 1.5, MAX_OUTPUT_TOKENS + 1, '100'])('recusa max_tokens = %s', (value) => {
    expect(refusal(withBody((b) => (b['max_tokens'] = value)))).toBe('body');
  });

  it('exige streaming', () => {
    expect(refusal(withBody((b) => (b['stream'] = false)))).toBe('body');
    expect(refusal(withBody((b) => delete b['stream']))).toBe('body');
  });

  it.each([
    ['mcp_servers', [{ type: 'url', url: 'https://atacante.example/mcp', name: 'x' }]],
    ['container', { id: 'c' }],
    ['fallbacks', 'default'],
    ['speed', 'fast'],
    ['temperature', 0.5],
    ['metadata', { user_id: 'x' }],
    ['context_management', { edits: [] }],
    ['inference_geo', 'us'],
    ['service_tier', 'auto'],
    ['__proto__', { model: 'claude-opus-5-5' }],
  ])('recusa o campo %s', (field, value) => {
    const body = JSON.stringify(aiSdkBody()).replace(/^\{/, `{${JSON.stringify(field)}:${JSON.stringify(value)},`);
    expect(refusal(request({ body }))).toBe('body');
  });

  it('recusa ferramenta de servidor (busca e leitura na web, execução de código)', () => {
    for (const tool of [
      { type: 'web_search_20260209', name: 'web_search' },
      { type: 'web_fetch_20260209', name: 'web_fetch' },
      { type: 'code_execution_20260521', name: 'code_execution' },
      { type: 'custom', name: 'file_read', description: 'x', input_schema: { type: 'object' } },
    ]) {
      expect(refusal(withBody((b) => (b['tools'] = [tool])))).toBe('body');
    }
  });

  it('recusa ferramenta fora da lista, também numa chamada antiga do histórico', () => {
    expect(refusal(request(), { toolNames: ['file_list'] })).toBe('body');
    expect(
      refusal(
        withBody((b) => {
          const messages = b['messages'] as { content: { name?: string }[] }[];
          const call = messages[1]?.content[2];
          if (call !== undefined) call.name = 'shell_exec';
        }),
      ),
    ).toBe('body');
  });

  it('recusa imagem e documento, inclusive por URL', () => {
    const blocks = [
      { type: 'image', source: { type: 'url', url: 'https://atacante.example/?dados=segredo' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'document', source: { type: 'url', url: 'https://atacante.example/a.pdf' } },
      { type: 'document', source: { type: 'file', file_id: 'file_1' } },
      { type: 'search_result', source: 'https://atacante.example', title: 'x', content: [] },
    ];
    for (const block of blocks) {
      expect(refusal(withBody((b) => (b['messages'] = [{ role: 'user', content: [block] }])))).toBe('body');
    }
    const imageInResult = { type: 'tool_result', tool_use_id: 't', content: [blocks[0]] };
    expect(refusal(withBody((b) => (b['messages'] = [{ role: 'user', content: [imageInResult] }])))).toBe('body');
  });

  it('recusa cache de 1 hora, raciocínio com orçamento e esforço acima de alto', () => {
    expect(
      refusal(withBody((b) => (b['system'] = [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral', ttl: '1h' } }]))),
    ).toBe('body');
    expect(refusal(withBody((b) => (b['thinking'] = { type: 'enabled', budget_tokens: 2048 })))).toBe('body');
    expect(refusal(withBody((b) => (b['output_config'] = { effort: 'max' })))).toBe('body');
    expect(refusal(withBody((b) => (b['tool_choice'] = { type: 'tool', name: 'file_read' })))).toBe('body');
  });

  it('o detalhe da recusa diz onde e o quê, sem o conteúdo', () => {
    const result = checkApiRequest(
      withBody((b) => (b['messages'] = [{ role: 'user', content: [{ type: 'text', text: 'senha 1234', extra: 'segredo' }] }])),
      TOOLS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('messages.0.content');
    expect(result.detail).not.toContain('segredo');
    expect(result.detail).not.toContain('1234');
  });
});

describe('checkApiRequest: lista de ferramentas', () => {
  it('sem ferramentas liberadas (a fase 1 até a etapa 13), nenhuma ferramenta passa', () => {
    expect(refusal(request(), { toolNames: [] })).toBe('body');
  });
});
