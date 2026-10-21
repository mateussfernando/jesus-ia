/**
 * Respostas SSE da Messages API da Anthropic, no formato que a API manda, para os testes da conversa (o laço no
 * Cérebro e a ponta a ponta com a tela).
 */

export function sse(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function messageStart(inputTokens = 120): string {
  return sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
    },
  });
}

/** Bloco de raciocínio como o Haiku 5.5 manda: sem texto legível, só a assinatura (o raciocínio cifrado). */
export function thinkingBlock(index: number): string[] {
  return [
    sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }),
    sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'RXFRQkNnLi4u' } }),
    sse('content_block_stop', { type: 'content_block_stop', index }),
  ];
}

export function textBlock(index: number, pieces: readonly string[]): string[] {
  return [
    sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }),
    ...pieces.map((piece) => sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } })),
    sse('content_block_stop', { type: 'content_block_stop', index }),
  ];
}

export function messageEnd(stopReason = 'end_turn', outputTokens = 50): string[] {
  return [
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } }),
    sse('message_stop', { type: 'message_stop' }),
  ];
}

/** Uma resposta inteira: raciocínio e depois o texto, nos pedaços dados. */
export function answerEvents(pieces: readonly string[], options: { inputTokens?: number; outputTokens?: number } = {}): string[] {
  return [messageStart(options.inputTokens), ...thinkingBlock(0), ...textBlock(1, pieces), ...messageEnd('end_turn', options.outputTokens)];
}
