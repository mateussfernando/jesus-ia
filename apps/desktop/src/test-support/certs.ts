import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/**
 * Autoridade e certificado de servidor feitos na hora, só para os testes (nenhuma chave fica no repositório). O X.509
 * é montado em DER à mão, com as peças do `node:crypto` (par de chaves P-256 e assinatura ECDSA): sem `openssl` nem
 * pacote a mais, roda igual no Linux e no Windows.
 */

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

const sequence = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const explicit = (slot: number, content: Buffer) => tlv(0xa0 + slot, content);
const octets = (content: Buffer) => tlv(0x04, content);
const bits = (content: Buffer, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), content]));
const boolean = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const utf8 = (text: string) => tlv(0x0c, Buffer.from(text, 'utf8'));

function integer(value: Buffer): Buffer {
  let digits = value;
  while (digits.length > 1 && digits[0] === 0 && ((digits[1] ?? 0) & 0x80) === 0) digits = digits.subarray(1);
  if (((digits[0] ?? 0) & 0x80) !== 0) digits = Buffer.concat([Buffer.from([0]), digits]);
  return tlv(0x02, digits);
}

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const out = [40 * first + second];
  for (const part of rest) {
    const chunk = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  // UTCTime até 2049; depois, GeneralizedTime (RFC 5280).
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

const ECDSA_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));
const name = (commonName: string) => sequence(set(sequence(oid('2.5.4.3'), utf8(commonName))));
const extension = (id: string, critical: boolean, value: Buffer) => sequence(oid(id), ...(critical ? [boolean(true)] : []), octets(value));

function keyId(publicKey: KeyObject): Buffer {
  return createHash('sha1').update(publicKey.export({ type: 'spki', format: 'der' })).digest();
}

function pem(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

interface Issued {
  readonly cert: string;
  readonly key: string;
}

function issue(i: {
  subject: string;
  publicKey: KeyObject;
  issuer: string;
  issuerKey: KeyObject;
  extensions: Buffer[];
}): string {
  const now = Date.now();
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(randomBytes(16)),
    ECDSA_SHA256,
    name(i.issuer),
    sequence(time(new Date(now - 60 * 60 * 1000)), time(new Date(now + 2 * 24 * 60 * 60 * 1000))),
    name(i.subject),
    i.publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, sequence(...i.extensions)),
  );
  const signature = sign('sha256', tbs, i.issuerKey);
  return pem(sequence(tbs, ECDSA_SHA256, bits(signature)));
}

export interface TestPki {
  /** Autoridade de teste (PEM), para pôr em `ca` ou em `NODE_EXTRA_CA_CERTS`. */
  readonly ca: string;
  /** Certificado do servidor (PEM) para `localhost` e `127.0.0.1`, assinado pela autoridade. */
  readonly server: Issued;
}

export function createTestPki(hosts: { dns?: readonly string[]; ips?: readonly string[] } = {}): TestPki {
  const ca = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const leaf = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const caCert = issue({
    subject: 'Jesus Teste CA',
    publicKey: ca.publicKey,
    issuer: 'Jesus Teste CA',
    issuerKey: ca.privateKey,
    extensions: [
      extension('2.5.29.19', true, sequence(boolean(true))),
      // keyCertSign e cRLSign.
      extension('2.5.29.15', true, bits(Buffer.from([0x06]), 1)),
      extension('2.5.29.14', false, octets(keyId(ca.publicKey))),
    ],
  });
  const dns = hosts.dns ?? ['localhost'];
  const ips = hosts.ips ?? ['127.0.0.1'];
  const altNames = [
    ...dns.map((host) => tlv(0x82, Buffer.from(host, 'ascii'))),
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
  ];
  const serverCert = issue({
    subject: dns[0] ?? 'localhost',
    publicKey: leaf.publicKey,
    issuer: 'Jesus Teste CA',
    issuerKey: ca.privateKey,
    extensions: [
      extension('2.5.29.19', true, sequence()),
      // digitalSignature.
      extension('2.5.29.15', true, bits(Buffer.from([0x80]), 7)),
      extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1'))),
      extension('2.5.29.17', false, sequence(...altNames)),
      extension('2.5.29.35', false, sequence(tlv(0x80, keyId(ca.publicKey)))),
    ],
  });
  return {
    ca: caCert,
    server: { cert: serverCert, key: leaf.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
  };
}
