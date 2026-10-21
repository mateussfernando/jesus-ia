import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BRAIN_KEY_PLACEHOLDER, MAX_API_BODY_BYTES } from '../../bridge/brain-protocol';
import { API_URL, checkApiRequest, checkedArray, MAX_JSON_DEPTH, MAX_JSON_NODES, MAX_OUTPUT_TOKENS } from './api-policy';
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
    // Sai o que foi conferido, inteiro (sem espaços, com as chaves na ordem do esquema).
    expect(JSON.parse(result.request.body)).toEqual(aiSdkBody());
    expect(result.request.body).not.toContain('\n');
    expect(result.request.bodyBytes).toBe(Buffer.byteLength(result.request.body));
    expect(result.request.betas).toEqual(['mid-conversation-system-2026-04-07', 'structured-outputs-2025-11-13']);
    expect(result.request.maxTokens).toBe(4096);
    expect(result.request.messages).toBe(4);
    expect(result.request.tools).toBe(1);
    expect(result.request.thinkingBlocks).toBe(1);
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

  /** Caminhos de cada objeto do corpo do AI SDK: um campo desconhecido em qualquer nível é recusado. */
  type Json = Record<string, unknown>;
  const at = (body: Json, path: (string | number)[]): Json => path.reduce<unknown>((node, key) => (node as Json)[key], body) as Json;
  it.each([
    ['raiz', []],
    ['mensagem do usuário', ['messages', 0]],
    ['mensagem do assistente', ['messages', 1]],
    ['mensagem de sistema', ['messages', 3]],
    ['bloco de texto', ['messages', 0, 'content', 0]],
    ['bloco de raciocínio', ['messages', 1, 'content', 0]],
    ['chamada de ferramenta', ['messages', 1, 'content', 2]],
    ['resultado de ferramenta', ['messages', 2, 'content', 0]],
    ['texto dentro do resultado', ['messages', 2, 'content', 0, 'content', 0]],
    ['texto da mensagem de sistema', ['messages', 3, 'content', 0]],
    ['texto do sistema', ['system', 0]],
    ['cache_control', ['system', 0, 'cache_control']],
    ['thinking', ['thinking']],
    ['output_config', ['output_config']],
    ['tool_choice', ['tool_choice']],
    ['ferramenta', ['tools', 0]],
  ] as [string, (string | number)[]][])('recusa campo desconhecido em: %s', (_name, path) => {
    expect(refusal(withBody((b) => (at(b, path)['campo_novo'] = 'x')))).toBe('body');
  });

  it('recusa campo desconhecido no raciocínio omitido (redacted_thinking)', () => {
    const redacted = { type: 'redacted_thinking', data: 'cifrado' };
    const content = (b: Json) => at(b, ['messages', 1, 'content']) as unknown as Json[];
    expect(refusal(withBody((b) => content(b).unshift(redacted)))).toBeNull();
    // Os dois tipos de raciocínio devolvido contam para a reserva.
    expect(checkApiRequest(withBody((b) => content(b).unshift(redacted)), TOOLS)).toMatchObject({ ok: true, request: { thinkingBlocks: 2 } });
    expect(refusal(withBody((b) => content(b).unshift({ ...redacted, extra: 1 })))).toBe('body');
  });

  it('recusa imagem e documento também no sistema e na resposta do assistente', () => {
    const image = { type: 'image', source: { type: 'url', url: 'https://atacante.example/?dados=segredo' } };
    const document = { type: 'document', source: { type: 'url', url: 'https://atacante.example/a.pdf' } };
    for (const block of [image, document]) {
      expect(refusal(withBody((b) => (b['system'] = [block])))).toBe('body');
      expect(refusal(withBody((b) => (b['messages'] = [{ role: 'system', content: [block] }])))).toBe('body');
      expect(refusal(withBody((b) => (b['messages'] = [{ role: 'user', content: 'oi' }, { role: 'assistant', content: [block] }])))).toBe('body');
    }
  });

  it('corpo de 2 MB cheio de elementos inválidos: recusado sem prender o principal', () => {
    const filler = (item: string) => `[${Array.from({ length: Math.floor((MAX_API_BODY_BYTES - 400) / (item.length + 1)) }, () => item).join(',')}]`;
    const base = '"model":"claude-haiku-5-5","max_tokens":10,"stream":true';
    const bodies = [
      `{${base},"messages":[{"role":"user","content":"x"}],"tools":${filler('{}')}}`,
      `{${base},"messages":${filler('{}')}}`,
      `{${base},"messages":[{"role":"user","content":${filler('{}')}}]}`,
      `{${base},"system":${filler('1')},"messages":[{"role":"user","content":"x"}]}`,
      `{${base},"messages":[{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":${filler('{}')}}]}]}`,
    ];
    for (const body of bodies) {
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_API_BODY_BYTES);
      const started = performance.now();
      expect(checkApiRequest(request({ body }), TOOLS)).toMatchObject({ ok: false, refusal: 'json', detail: 'valores demais' });
      // Sem os limites, cada um levava de 1 a 8 s (e mais de 1 GB de memória); hoje, o grosso é o JSON.parse.
      expect(performance.now() - started).toBeLessThan(2_000);
    }
    // Abaixo do limite de valores, a lista é medida antes dos elementos.
    const tools = `{${base},"messages":[{"role":"user","content":"x"}],"tools":[${Array.from({ length: 100_000 }, () => '{}').join(',')}]}`;
    expect(checkApiRequest(request({ body: tools }), TOOLS)).toMatchObject({ ok: false, refusal: 'body', detail: 'tools: too_big' });
    const messages = `{${base},"messages":[${Array.from({ length: 100_000 }, () => '{}').join(',')}]}`;
    expect(checkApiRequest(request({ body: messages }), TOOLS)).toMatchObject({ ok: false, refusal: 'body', detail: 'messages: too_big' });
  });

  it('cada lista é medida antes dos elementos, e os elementos param no primeiro erro', () => {
    let checked = 0;
    const counting = z.custom<string>((value) => {
      checked += 1;
      return typeof value === 'string';
    });
    const list = checkedArray(counting, { min: 1, max: 5 });
    expect(list.safeParse(['a', 'b']).data).toEqual(['a', 'b']);
    checked = 0;
    const bad = list.safeParse(['a', 1, 2, 3]);
    expect(checked).toBe(2);
    expect(bad.error?.issues.map((issue) => [issue.code, issue.path])).toEqual([['custom', [1]]]);
    checked = 0;
    expect(list.safeParse(['a', 'b', 'c', 'd', 'e', 'f']).error?.issues[0]?.code).toBe('too_big');
    expect(list.safeParse([]).error?.issues[0]?.code).toBe('too_small');
    expect(list.safeParse('a').error?.issues[0]?.code).toBe('invalid_type');
    expect(checked).toBe(0);
  });

  it('recusa corpo com valores demais; um pedido grande de verdade passa', () => {
    const many = `{"model":"claude-haiku-5-5","max_tokens":10,"stream":true,"messages":[{"role":"user","content":"x"}],"tools":[{"name":"file_read","description":"x","input_schema":{"a":[${Array.from({ length: MAX_JSON_NODES }, () => '0').join(',')}]}}]}`;
    expect(checkApiRequest(request({ body: many }), TOOLS)).toMatchObject({ ok: false, refusal: 'json', detail: 'valores demais' });
    // 2 MB de conversa: 10 mil mensagens de texto.
    const big = { model: 'claude-haiku-5-5', max_tokens: 10, stream: true, messages: Array.from({ length: 9_999 }, () => ({ role: 'user', content: 'a'.repeat(180) })) };
    expect(refusal(request({ bodyObject: big }))).toBeNull();
  });

  it('recusa aninhamento fundo demais, sem estourar a pilha', () => {
    // Montado como texto: o próprio JSON.stringify do teste estouraria a pilha.
    const nested = (levels: number) => `${'['.repeat(levels)}${']'.repeat(levels)}`;
    const withInput = (value: string) => request({ body: JSON.stringify(aiSdkBody()).replace('"input":{"path":"a.txt"}', `"input":{"a":${value}}`) });
    for (const levels of [MAX_JSON_DEPTH, 5_000, 100_000]) {
      expect(checkApiRequest(withInput(nested(levels)), TOOLS)).toMatchObject({ ok: false, refusal: 'json', detail: 'aninhamento fundo demais' });
    }
    const schema = JSON.stringify(aiSdkBody()).replace('"input_schema":{', `"input_schema":{"x":${nested(10_000)},`);
    expect(refusal(request({ body: schema }))).toBe('json');
    // O que um esquema de verdade usa passa.
    expect(refusal(withInput(nested(20)))).toBeNull();
  });

  it('recusa texto com metade de um par de surrogates solta (sairia com o dobro do tamanho medido)', () => {
    const lone = String.fromCharCode(0xd800);
    const body = JSON.stringify(aiSdkBody()).replace('"Oi"', `"${lone.repeat(10)}"`);
    expect(checkApiRequest(request({ body }), TOOLS)).toMatchObject({ ok: false, refusal: 'json' });
    // O par inteiro (emoji) passa.
    expect(refusal(request({ body: JSON.stringify(aiSdkBody()).replace('"Oi"', '"Oi \ud83d\ude00 😀"') }))).toBeNull();
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
