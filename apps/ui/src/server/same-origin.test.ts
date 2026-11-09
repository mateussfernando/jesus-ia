import { describe, expect, it } from 'vitest';
import { isJsonRequest, isSameOriginRequest } from './same-origin';

const headers = (values: Record<string, string>) => new Headers(values);

describe('conferência de origem das rotas', () => {
  it('sem Origin nem Sec-Fetch-Site (a janela do app de desktop): passa', () => {
    expect(isSameOriginRequest(headers({ host: 'jesus.invalid' }))).toBe(true);
  });

  it('mesma origem: passa (inclusive com a porta, no desenvolvimento)', () => {
    expect(isSameOriginRequest(headers({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOriginRequest(headers({ host: 'jesus.invalid', origin: 'https://jesus.invalid' }))).toBe(true);
    expect(isSameOriginRequest(headers({ host: 'Jesus.Invalid', origin: 'https://jesus.invalid:443' }))).toBe(true);
  });

  it('outra porta, outro nome, origem opaca ou outro esquema: recusa', () => {
    for (const values of [
      { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:8080' },
      { host: '127.0.0.1:5173', origin: 'http://localhost:5173' },
      { host: '127.0.0.1:5173', origin: 'null' },
      { host: '127.0.0.1:5173', origin: 'file:///C:/pagina.html' },
      { host: '127.0.0.1:5173', origin: 'não é url' },
      { origin: 'http://127.0.0.1:5173' },
      { host: '127.0.0.1:5173', 'sec-fetch-site': 'same-site' },
      { host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' },
      { host: '127.0.0.1:5173', 'sec-fetch-site': 'none' },
      { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-site' },
    ]) {
      expect(isSameOriginRequest(headers(values)), JSON.stringify(values)).toBe(false);
    }
  });

  it('só corpo JSON', () => {
    expect(isJsonRequest(headers({ 'content-type': 'application/json' }))).toBe(true);
    expect(isJsonRequest(headers({ 'content-type': 'Application/JSON; charset=utf-8' }))).toBe(true);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json-patch+json']) {
      expect(isJsonRequest(headers({ 'content-type': type })), type).toBe(false);
    }
    expect(isJsonRequest(headers({}))).toBe(false);
  });
});
