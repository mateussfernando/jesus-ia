import { describe, expect, it } from 'vitest';
import { HIGH_CONFIDENCE_SECRETS, maskSecrets } from './mask-secrets';
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

  it('milhares de achados não deixam o custo quadrático (arquivo de 2 MB cheio de "senhas")', () => {
    const paragraph = 'A senha do Wi-Fi é Abc123!xyz e o código 123456 chegou por SMS. Linha comum, sem nada.\n';
    const big = paragraph.repeat(Math.ceil(2_000_000 / paragraph.length));
    const started = performance.now();
    const result = maskSecrets(big);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result.text).not.toContain('Abc123!xyz');
    expect(result.text).not.toContain('123456');
    expect(result.findings.length).toBeGreaterThan(40_000);
  });
});

describe('base64 com barra', () => {
  // A chave secreta de exemplo da documentação da AWS, montada por partes.
  const AWS_SECRET = join('wJalrXUtnFEMI', '/K7MDENG/', 'bPxRfiCYEXAMPLEKEY');
  const PEM_LINE = join('MIIEowIBAAKCAQEAt7cP3c', '/9V2g8Zt1bEqkR4mXyL', '+u0Hn5Wq2Jd7Kf8LmZp3RsTv6Yb1Ce4Gh9IjNo0Q');

  it('a chave secreta da AWS sai, mesmo sem palavra-chave por perto', () => {
    const result = maskSecrets(`AWS_SECRET_ACCESS_KEY: ${AWS_SECRET}`);
    expect(result.text).not.toContain('bPxRfiCY');
    expect(result.findings).toContain('high_entropy');
  });

  it('uma linha do corpo de uma chave PEM, vista sem o cabeçalho, sai inteira', () => {
    const result = maskSecrets(`${PEM_LINE}\n${PEM_LINE}\n`);
    expect(result.text).toBe('[segredo removido: token]\n[segredo removido: token]\n');
  });

  it('caminhos e URLs com barra ficam', () => {
    for (const text of [
      'veja src/components/Button/index.tsx e /home/mateus/Projetos/jesus/apps/desktop/src/main',
      'com/example/projectname/SomeLongClassName2023/Impl',
      '/api/v1/users/12345/orders/67890/items/1/details/2023',
      'https://github.com/mateussfernando/jesus-ia/blob/main/apps/desktop/src/main/ui-server.ts',
      '/Users/Mateus/Projetos2023/Relatorios/Q3/Final2/Resumo',
    ]) {
      expect(maskSecrets(text), text).toEqual({ text, findings: [], maskedChars: 0 });
    }
  });
});

describe('opções', () => {
  const PEM = join('-----BEGIN ', 'PRIVATE KEY-----\nlinha1\nlinha2\nlinha3\n-----END ', 'PRIVATE KEY-----');

  it('keepLines: a chave de várias linhas vira a marca com as mesmas quebras', () => {
    const text = `antes\n${PEM}\ndepois`;
    const kept = maskSecrets(text, { keepLines: true });
    expect(kept.text).toBe('antes\n[segredo removido: chave privada]\n\n\n\n\ndepois');
    expect(kept.text.split('\n')).toHaveLength(text.split('\n').length);
    expect(maskSecrets(text).text).toBe('antes\n[segredo removido: chave privada]\ndepois');
    // Idempotente também assim.
    expect(maskSecrets(kept.text, { keepLines: true })).toEqual({ text: kept.text, findings: [], maskedChars: 0 });
  });

  it('kinds: só as regras pedidas', () => {
    const text = 'a senha do Wi-Fi é Abc123!xyz';
    expect(maskSecrets(text, { kinds: ['api_key'] }).findings).toEqual([]);
    expect(maskSecrets(text, { kinds: ['password'] }).findings).toEqual(['password']);
  });

  it('nomes de arquivo comuns passam pelas regras de alta confiança sem mudar', () => {
    for (const name of [
      'Screenshot_2023-10-15-12-34-56-789_com.whatsapp.jpg',
      'relatorio_final_v2_2023-10-15_revisado_marcos.docx',
      'VID_20231015_123456789_HDR_Pro_Edition4K.mp4',
      'Comprovante_Pix_E00000000202310151234abcdEFGH567.pdf',
      'senha do banco 1234.txt',
      'Basic Electrical-Engineering.pdf',
      'Código 2023 relatório.pdf',
    ]) {
      expect(maskSecrets(name, { kinds: HIGH_CONFIDENCE_SECRETS }), name).toEqual({ text: name, findings: [], maskedChars: 0 });
    }
  });

  it('e uma chave de API no nome sai', () => {
    const name = `${join('sk-', 'ant-', 'api03-', RANDOM)}.txt`;
    expect(maskSecrets(name, { kinds: HIGH_CONFIDENCE_SECRETS }).text).toBe('[segredo removido: chave de API].txt');
  });
});
