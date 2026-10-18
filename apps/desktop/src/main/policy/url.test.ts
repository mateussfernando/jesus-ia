import { describe, expect, it } from 'vitest';
import { isAllowedCommittedFrame, isAllowedNavigation, isAppOrigin, isAppUrl } from './url';

describe('endereços da janela', () => {
  it('aceita só https://jesus.invalid', () => {
    expect(isAppUrl('https://jesus.invalid/')).toBe(true);
    expect(isAppUrl('https://jesus.invalid/cenarios/?x=1#y')).toBe(true);
    expect(isAppUrl('https://JESUS.invalid/entrar/')).toBe(true);
  });

  it('recusa o resto', () => {
    for (const url of [
      'http://jesus.invalid/',
      'https://jesus.invalid.evil/',
      'https://evil.jesus.invalid/',
      'https://u@jesus.invalid/',
      'https://u:p@jesus.invalid/',
      'https://jesus.invalid:8443/',
      'https://example.com/',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'blob:https://example.com/uuid',
      'about:blank',
      'não é url',
      '',
    ]) {
      expect(isAllowedNavigation(url), url).toBe(false);
    }
  });

  it('a origem de um quadro só vale se for a do app', () => {
    expect(isAppOrigin('https://jesus.invalid')).toBe(true);
    expect(isAppOrigin('null')).toBe(false);
    expect(isAppOrigin('https://jesus.invalid/')).toBe(false);
    expect(isAppOrigin('http://jesus.invalid')).toBe(false);
  });

  it('vigia de quadros: a página principal só fica em endereço do app; os quadros, só com a origem do app', () => {
    const app = 'https://jesus.invalid';
    expect(isAllowedCommittedFrame({ url: `${app}/entrar/`, origin: app, isMainFrame: true })).toBe(true);
    // about:blank herda a origem de quem navegou: a origem bate, mas a página principal não pode ficar ali.
    expect(isAllowedCommittedFrame({ url: 'about:blank', origin: app, isMainFrame: true })).toBe(false);
    expect(isAllowedCommittedFrame({ url: 'about:blank', origin: app, isMainFrame: false })).toBe(true);
    expect(isAllowedCommittedFrame({ url: 'about:srcdoc', origin: 'null', isMainFrame: false })).toBe(false);
    expect(isAllowedCommittedFrame({ url: 'about:blank', origin: 'null', isMainFrame: false })).toBe(false);
    expect(isAllowedCommittedFrame({ url: 'chrome-error://chromewebdata/', origin: 'null', isMainFrame: true })).toBe(false);
  });
});
