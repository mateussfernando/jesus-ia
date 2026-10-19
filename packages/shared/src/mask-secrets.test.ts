import { describe, expect, it } from 'vitest';
import { maskSecrets } from './mask-secrets';
import type { SecretKind } from './mask-secrets';

/**
 * Os segredos de exemplo são falsos e montados por partes: nenhum padrão de token aparece inteiro no código-fonte
 * (a varredura de segredos do GitHub não acusa o repositório).
 */
const join = (...parts: string[]) => parts.join('');
// 32 caracteres, como a parte aleatória dos tokens de verdade.
const RANDOM = 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu';

const SAMPLES: readonly { name: string; text: string; secret: string; kind: SecretKind }[] = [
  { name: 'Anthropic', secret: join('sk-', 'ant-', 'api03-', RANDOM, 'AbC'), text: 'chave: %s', kind: 'api_key' },
  { name: 'OpenAI', secret: join('sk-', 'proj-', RANDOM), text: 'use %s no teste', kind: 'api_key' },
  { name: 'GitHub clássico', secret: join('gh', 'p_', RANDOM, 'abcd'), text: 'token %s.', kind: 'api_key' },
  { name: 'GitHub de instalação', secret: join('gh', 's_', RANDOM, 'wxyz'), text: '%s', kind: 'api_key' },
  { name: 'GitHub fino', secret: join('github', '_pat_', RANDOM, '_', RANDOM), text: 'pat=%s', kind: 'api_key' },
  { name: 'Google', secret: join('AI', 'za', RANDOM, 'XyZ'), text: 'key %s', kind: 'api_key' },
  { name: 'Google OAuth', secret: join('GOC', 'SPX-', RANDOM), text: 'cliente %s', kind: 'api_key' },
  { name: 'Slack', secret: join('xo', 'xb-', '1234567890-', RANDOM), text: '%s', kind: 'api_key' },
  { name: 'AWS', secret: join('AK', 'IA', 'Q7LM2XV9RT4KP8ZW'), text: 'aws %s', kind: 'api_key' },
  { name: 'Stripe', secret: join('sk', '_live_', RANDOM), text: '%s', kind: 'api_key' },
  { name: 'npm', secret: join('np', 'm_', RANDOM, 'abcd'), text: '%s', kind: 'api_key' },
  {
    name: 'JWT',
    secret: join('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJ', 'zdWIiOiIxMjM0In0', '.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),
    text: 'cookie de sessão %s',
    kind: 'jwt',
  },
  {
    name: 'chave privada',
    secret: join('-----BEGIN ', 'RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA', RANDOM, '\n-----END RSA ', 'PRIVATE KEY-----'),
    text: 'arquivo:\n%s\nfim',
    kind: 'private_key',
  },
  { name: 'Bearer', secret: join('abc.', RANDOM, '-_~'), text: 'Authorization: Bearer %s', kind: 'bearer' },
  { name: 'senha em URL de conexão', secret: 'S3nh@Forte', text: 'postgres://jesus:%s@127.0.0.1:5432/jesus', kind: 'connection_string' },
  { name: 'senha por proximidade (exemplo do rascunho)', secret: 'Abc123!xyz', text: 'a senha do Wi-Fi é %s', kind: 'password' },
  { name: 'senha por atribuição, sem dígito', secret: 'batatinha', text: 'senha: %s', kind: 'password' },
  { name: 'senha em JSON', secret: 'hunter-two', text: '{"password": "%s"}', kind: 'password' },
  { name: 'PIN', secret: '4821', text: 'meu pin é %s', kind: 'password' },
  { name: 'código de verificação', secret: '482913', text: 'Seu código de verificação: %s', kind: 'otp' },
  { name: 'código do device flow', secret: 'WDJB-MJHT', text: 'Digite o código WDJB-MJHT em github.com/login/device'.replace('WDJB-MJHT', '%s'), kind: 'device_code' },
  { name: 'CVV', secret: '737', text: 'cartão final 1111, CVV %s', kind: 'cvv' },
  { name: 'token de alta entropia', secret: join('Zx8', RANDOM, 'Qw9'), text: 'valor %s aqui', kind: 'high_entropy' },
];

describe('mascaramento de segredos', () => {
  for (const sample of SAMPLES) {
    it(`${sample.name}: sai do texto e vira marca`, () => {
      const input = sample.text.replace('%s', sample.secret);
      const result = maskSecrets(input);
      expect(result.text).not.toContain(sample.secret);
      expect(result.findings).toContain(sample.kind);
      expect(result.text).toMatch(/\[segredo removido: [^\]]+\]/);
    });
  }

  it('exemplo do rascunho, palavra a palavra', () => {
    expect(maskSecrets('a senha do Wi-Fi é Abc123!xyz').text).toBe('a senha do Wi-Fi é [segredo removido: senha]');
  });

  it('cartão que passa no Luhn fica só com o final; o que não passa fica como está', () => {
    expect(maskSecrets('paguei com 4111 1111 1111 1111 ontem').text).toBe('paguei com [cartão •••• 1111] ontem');
    expect(maskSecrets('cartão 5500-0000-0000-0004.').findings).toEqual(['card_pan']);
    expect(maskSecrets('pedido 4111 1111 1111 1112').text).toBe('pedido 4111 1111 1111 1112');
  });

  it('URL de conexão: só a senha sai', () => {
    expect(maskSecrets('postgres://jesus:S3nh4@127.0.0.1:5432/jesus').text).toBe(
      'postgres://jesus:[segredo removido: senha de conexão]@127.0.0.1:5432/jesus',
    );
  });

  it('Bearer: o esquema fica, o token sai', () => {
    expect(maskSecrets(`Authorization: Bearer ${join('abc.', RANDOM)}`).text).toBe('Authorization: Bearer [segredo removido: token]');
  });

  it('texto comum fica intacto', () => {
    for (const text of [
      'Bom dia! Hoje é 19/10/2026 e a reunião é às 14h30.',
      'O arquivo está em C:\\Users\\Mateus\\Documentos\\notas-da-semana-2026.txt',
      'Veja /home/user/jesus-ia/apps/desktop/src/main/ui-server.ts:318',
      'https://github.com/mateussfernando/jesus-ia/pull/1',
      'commit b9dde245cec012e65daf0a27fcb4d15e2943bca0',
      'id 123e4567-e89b-12d3-a456-426614174000',
      'sha256 65b933af08cb1028293f25808619bf58f27bcae7a77fb4ee968792f44914e369',
      'A senha precisa ter 12 caracteres.',
      'Conecte no Wi-Fi da sala.',
      'Ligue para 11 98765-4321.',
      'kebab-case-identificador-bem-comprido-sem-digito',
    ]) {
      expect(maskSecrets(text), text).toEqual({ text, findings: [], maskedChars: 0 });
    }
  });

  it('a regra mais específica fica com o trecho (a chave dentro de uma atribuição é chave de API)', () => {
    const key = join('sk-', 'ant-', 'api03-', RANDOM);
    expect(maskSecrets(`api_key=${key}`).findings).toEqual(['api_key']);
  });

  it('conta os caracteres mascarados do texto original', () => {
    const result = maskSecrets('senha: abcd1234 e PIN 9876');
    expect(result.maskedChars).toBe('abcd1234'.length + '9876'.length);
  });

  it('idempotente: mascarar o resultado não muda nada nem acha mais nada', () => {
    for (const sample of SAMPLES) {
      const once = maskSecrets(sample.text.replace('%s', sample.secret));
      expect(maskSecrets(once.text), sample.name).toEqual({ text: once.text, findings: [], maskedChars: 0 });
    }
  });

  it('idempotente também em textos misturados ao acaso (gerador com semente fixa)', () => {
    let seed = 20261019;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pieces = [
      ...SAMPLES.map((sample) => sample.secret),
      'senha',
      'senha:',
      'password=',
      'código',
      'PIN',
      'CVV',
      'Bearer',
      'é',
      'do',
      'Wi-Fi',
      '4111 1111 1111 1111',
      '1234',
      '987654',
      'ABCD-EFGH',
      'texto',
      '\n',
      '\n\n',
      '"',
      ':',
      '[segredo removido: senha]',
      '[cartão •••• 1111]',
    ];
    for (let round = 0; round < 400; round++) {
      const words: string[] = [];
      const count = 1 + Math.floor(random() * 14);
      for (let i = 0; i < count; i++) words.push(pieces[Math.floor(random() * pieces.length)] ?? '');
      const text = words.join(random() < 0.5 ? ' ' : '');
      const once = maskSecrets(text);
      expect(maskSecrets(once.text), JSON.stringify(text)).toEqual({ text: once.text, findings: [], maskedChars: 0 });
      // Os segredos que valem sozinhos (sem precisar de palavra-chave ou de contexto) nunca sobram.
      for (const sample of SAMPLES.filter((item) => ['api_key', 'jwt', 'private_key', 'high_entropy'].includes(item.kind))) {
        if (text.includes(sample.secret)) expect(once.text, JSON.stringify(text)).not.toContain(sample.secret);
      }
    }
  });

  it('texto grande e repetitivo não trava (sem retrocesso catastrófico)', () => {
    const big = `${'1'.repeat(50_000)} ${'a-'.repeat(50_000)} ${'senha '.repeat(5_000)} ${'x'.repeat(100_000)}`;
    const started = performance.now();
    maskSecrets(big);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
