import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyNativeRemoteAudioUrl, proxyNativeScopedResourceUrl } from '@/services/nativeRemoteAudio';

// 桥接边界的纯合成测试；所有原生调用只记录参数，不发生网络 IO。
afterEach(() => vi.unstubAllGlobals());

describe('native resource forwarding', () => {
    it.each([
        'https://other.synthetic.test/image',
        'http://nas.synthetic.test/image',
        'https://nas.synthetic.test:8443/image',
        'https://synthetic@nas.synthetic.test/image',
        'file:///image',
    ])('rejects an incorrectly bound credential target %s', async (url) => {
        const register = vi.fn();
        vi.stubGlobal('window', { Capacitor: { Plugins: { FoliaNative: {
            registerScopedRemoteAudio: register, unregisterRemoteAudio: vi.fn(),
        } } } });
        expect(await proxyNativeScopedResourceUrl(url, {
            credentialOrigin: 'https://nas.synthetic.test', headers: { Cookie: 'SYNTHETIC' },
        })).toBe(url);
        expect(register).not.toHaveBeenCalled();
    });

    it('preserves the existing credential-bearing audio API', async () => {
        const registerRemoteAudio = vi.fn(async () => ({ proxied: true, url: 'http://127.0.0.1:45678/remote-audio/audio' }));
        vi.stubGlobal('window', { Capacitor: { Plugins: { FoliaNative: { registerRemoteAudio } } } });
        const url = 'https://nas.synthetic.test/music/api/v1/track/stream';
        expect(await proxyNativeRemoteAudioUrl(url, {
            headers: { Cookie: 'SYNTHETIC' }, allowAnyHost: true,
        })).toContain('/remote-audio/audio');
        expect(registerRemoteAudio).toHaveBeenCalledExactlyOnceWith({
            url, headers: { Cookie: 'SYNTHETIC' }, allowAnyHost: true,
        });
    });

    it('does not mistake a hostname substring for a local URL', async () => {
        const registerRemoteAudio = vi.fn(async () => ({ proxied: false }));
        vi.stubGlobal('window', { Capacitor: { Plugins: { FoliaNative: { registerRemoteAudio } } } });
        await proxyNativeRemoteAudioUrl('https://localhost.synthetic.test/audio');
        expect(registerRemoteAudio).toHaveBeenCalledTimes(1);
    });

    it('leaves the default CDN and local-file behavior intact', async () => {
        const registerRemoteAudio = vi.fn(async (_options: { url: string }) => ({ proxied: true, url: 'http://127.0.0.1:45678/remote-audio/cdn' }));
        vi.stubGlobal('window', { Capacitor: { Plugins: { FoliaNative: { registerRemoteAudio } } } });
        expect(await proxyNativeRemoteAudioUrl('https://cdn.synthetic.test/audio')).toContain('/remote-audio/cdn');
        expect(registerRemoteAudio.mock.calls[0][0]).toEqual({ url: 'https://cdn.synthetic.test/audio' });
        for (const url of ['blob:synthetic', 'data:audio/ogg;base64,AA==', 'http://127.0.0.1:45678/audio/1']) {
            expect(await proxyNativeRemoteAudioUrl(url)).toBe(url);
        }
        expect(registerRemoteAudio).toHaveBeenCalledTimes(1);
    });
});
