// CSP rígida para a exportação estática do Next.js (decisão 0013; seção 3.12).
//
// O App Router coloca scripts inline em cada página. Em vez de liberar `unsafe-inline`, este passo calcula o
// SHA-256 de cada script inline e grava a política na própria página, logo depois do `<meta charset>`:
// `script-src 'self' 'sha256-…'`. Rode depois do `next build` (o script `build` do pacote já faz isso).
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Diretivas fixas; `script-src` recebe os hashes de cada página. */
export const BASE_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const CSP_META = /<meta http-equiv="Content-Security-Policy"[^>]*>/i;

/** Texto de cada `<script>` inline (sem `src`), exatamente como está no HTML. */
export function inlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(SCRIPT)) {
    const attrs = match[1] ?? '';
    if (/\ssrc\s*=/i.test(attrs)) continue;
    scripts.push(match[2] ?? '');
  }
  return scripts;
}

/** Fonte de hash no formato da CSP. */
export function scriptHash(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** Política completa para uma página. */
export function buildPolicy(hashes) {
  const unique = [...new Set(hashes)].sort();
  return [...BASE_DIRECTIVES.slice(0, 1), ["script-src 'self'", ...unique].join(' '), ...BASE_DIRECTIVES.slice(1)].join('; ');
}

/**
 * Grava a CSP na página. Fica logo depois do `<meta charset>` (que precisa estar nos primeiros 1024 bytes) e
 * antes de qualquer script. Rodar duas vezes dá o mesmo resultado.
 */
export function injectCsp(html) {
  const withoutOld = html.replace(CSP_META, '');
  const policy = buildPolicy(inlineScripts(withoutOld).map(scriptHash));
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const charset = /<meta charset(?:Set)?="utf-8"\s*\/?>/i.exec(withoutOld);
  if (charset !== null) {
    const end = charset.index + charset[0].length;
    return withoutOld.slice(0, end) + meta + withoutOld.slice(end);
  }
  const head = /<head[^>]*>/i.exec(withoutOld);
  if (head === null) throw new Error('página sem <head>: não dá para gravar a CSP');
  const end = head.index + head[0].length;
  return withoutOld.slice(0, end) + meta + withoutOld.slice(end);
}

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

/** Aplica em todas as páginas da pasta exportada. Devolve quantas páginas mudaram. */
export async function applyCspToDir(dir) {
  const files = await htmlFiles(dir);
  if (files.length === 0) throw new Error(`nenhuma página HTML em ${dir}`);
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    await writeFile(file, injectCsp(html), 'utf8');
  }
  return files.length;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? 'out';
  const count = await applyCspToDir(dir);
  console.log(`CSP com hashes gravada em ${String(count)} página(s) de ${dir}.`);
}
