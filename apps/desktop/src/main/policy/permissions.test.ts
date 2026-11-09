import { describe, expect, it } from 'vitest';
import { decidePermission, phase1PermissionPolicy } from './permissions';

const APP = 'https://jesus.invalid';

describe('permissões da janela', () => {
  it('na fase 1, nega tudo, até o microfone do próprio app', () => {
    for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read', 'midi', 'openExternal', 'fullscreen']) {
      expect(
        decidePermission({ permission, requestingOrigin: APP, isMainFrame: true, mediaTypes: ['audio'] }, phase1PermissionPolicy),
        permission,
      ).toBe(false);
    }
  });

  it('com o modo voz (fase 1.5), só o microfone do app no quadro principal', () => {
    const voice = { voice: true };
    expect(decidePermission({ permission: 'media', requestingOrigin: APP, isMainFrame: true, mediaTypes: ['audio'] }, voice)).toBe(true);
    expect(decidePermission({ permission: 'media', requestingOrigin: APP, isMainFrame: true, mediaTypes: ['video'] }, voice)).toBe(false);
    expect(
      decidePermission({ permission: 'media', requestingOrigin: APP, isMainFrame: true, mediaTypes: ['audio', 'video'] }, voice),
    ).toBe(false);
    expect(decidePermission({ permission: 'media', requestingOrigin: APP, isMainFrame: true, mediaTypes: [] }, voice)).toBe(false);
    expect(decidePermission({ permission: 'media', requestingOrigin: APP, isMainFrame: false, mediaTypes: ['audio'] }, voice)).toBe(false);
    expect(decidePermission({ permission: 'media', requestingOrigin: 'null', isMainFrame: true, mediaTypes: ['audio'] }, voice)).toBe(false);
    expect(decidePermission({ permission: 'notifications', requestingOrigin: APP, isMainFrame: true }, voice)).toBe(false);
  });
});
