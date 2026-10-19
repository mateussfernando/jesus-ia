import { describe, expect, it } from 'vitest';
import { createLogger, formatJsonLine, formatTextLine, isSecretKey, redact, REMOVED } from './logger';
import type { LogRecord } from './logger';

const KEY = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');

function capture(level?: 'debug' | 'info' | 'warn' | 'error') {
  const records: LogRecord[] = [];
  const logger = createLogger({ sink: (record) => records.push(record), now: () => 1_792_000_000_000, ...(level ? { level } : {}) });
  return { records, logger };
}

describe('logger com redação', () => {
  it('campo com nome de segredo sai inteiro, seja qual for o valor', () => {
    const { records, logger } = capture();
    logger.info('login', {
      password: 'qualquer coisa',
      Senha: 'x',
      'x-api-key': 'abc',
      Authorization: 'Bearer y',
      sessionToken: 'z',
      cookie: 'jesus_session=1',
      codigoDeRecuperação: 'AAAA-BBBB',
      usuario: 'mateus',
    });
    expect(records[0]?.fields).toEqual({
      password: REMOVED,
      Senha: REMOVED,
      'x-api-key': REMOVED,
      Authorization: REMOVED,
      sessionToken: REMOVED,
      cookie: REMOVED,
      codigoDeRecuperação: REMOVED,
      usuario: 'mateus',
    });
  });

  it('segredo dentro de texto comum é mascarado, também em listas, objetos aninhados e erros', () => {
    const { records, logger } = capture();
    logger.error('falha', { detalhe: `chamada com ${KEY}`, lista: [`k=${KEY}`], aninhado: { a: { b: KEY } }, erro: new Error(`falhou com ${KEY}`) });
    const line = formatJsonLine(records[0] as LogRecord);
    expect(line).not.toContain(KEY);
    expect(line).toContain('[segredo removido: chave de API]');
  });

  it('corta textos longos e põe teto em itens, campos e profundidade', () => {
    const { records, logger } = capture();
    let deep: unknown = 'fundo';
    for (let i = 0; i < 10; i++) deep = { d: deep };
    logger.info('grande', {
      texto: 'a'.repeat(5_000),
      lista: Array.from({ length: 60 }, (_, i) => i),
      deep,
      ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`c${String(i)}`, i])),
    });
    const fields = records[0]?.fields ?? {};
    expect(String(fields['texto'])).toMatch(/^a{2000}…\[\+3000\]$/);
    expect((fields['lista'] as unknown[]).at(-1)).toBe('[+10 itens]');
    expect(JSON.stringify(fields['deep'])).toContain('[profundo demais]');
    expect(fields['…']).toMatch(/^\[\+\d+ campos\]$/);
  });

  it('nível mínimo, campos fixos do filho e evento inválido', () => {
    const { records, logger } = capture('warn');
    logger.info('ignorado');
    const child = logger.child({ processo: 'jesus-next' });
    child.warn('aviso', { n: 1 });
    child.error('Evento Com Espaço');
    expect(records.map((record) => [record.event, record.fields])).toEqual([
      ['aviso', { processo: 'jesus-next', n: 1 }],
      ['evento-invalido', { processo: 'jesus-next' }],
    ]);
  });

  it('nunca lança, nem com valor que não vira JSON nem com o destino falhando', () => {
    const cycle: Record<string, unknown> = {};
    cycle['eu'] = cycle;
    const { records, logger } = capture();
    expect(() => logger.info('ciclo', { cycle, fn: () => 1, sym: Symbol('s'), big: 10n, nan: Number.NaN })).not.toThrow();
    expect(records[0]?.fields['big']).toBe('10');
    const broken = createLogger({
      sink: () => {
        throw new Error('disco cheio');
      },
    });
    expect(() => broken.info('qualquer')).not.toThrow();
  });

  it('formatos de linha', () => {
    const record: LogRecord = { ts: 0, level: 'info', event: 'servidor.pronto', fields: { ms: 5 } };
    expect(formatJsonLine(record)).toBe('{"ts":"1970-01-01T00:00:00.000Z","level":"info","event":"servidor.pronto","ms":5}');
    expect(formatTextLine(record, 'jesus')).toBe('[jesus] info servidor.pronto {"ms":5}');
    expect(formatTextLine({ ...record, fields: {} }, 'jesus')).toBe('[jesus] info servidor.pronto');
  });

  it('nomes de campo de segredo, sem diferenciar maiúsculas, acentos ou separadores', () => {
    for (const name of ['PASSWORD', 'api_key', 'apiKey', 'private-key', 'refresh_token', 'Credencial', 'recuperação', 'passphrase']) {
      expect(isSecretKey(name), name).toBe(true);
    }
    for (const name of ['usuario', 'path', 'status', 'duracaoMs', 'tool']) expect(isSecretKey(name), name).toBe(false);
    expect(redact({ nested: { token: 1 } })).toEqual({ nested: { token: REMOVED } });
  });
});
