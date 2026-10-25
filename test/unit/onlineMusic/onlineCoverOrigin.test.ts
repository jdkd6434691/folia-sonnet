import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult, UnifiedSong } from '@/types';

// 合成元数据经过真实封面服务与 native wrapper；不调用网络或读取用户存储。
const state = vi.hoisted(() => ({ values: new Map<string, string>(), announce: vi.fn() }));
vi.mock('@/services/onlineMusic/providerStorage', () => ({
    readProviderSessionValue: (_provider: string, key: string) => state.values.get(key) ?? null,
    writeProviderSessionValue: (_provider: string, key: string, value: string) => { state.values.set(key, value); },
    removeProviderSessionValue: (_provider: string, key: string) => { state.values.delete(key); },
}));
vi.mock('@/platform/foliaNative', () => ({
    isNativeHttpAvailable: () => false,
    nativeHttpRequest: vi.fn(() => { throw new Error('Network forbidden'); }),
    removeNativeCookie: vi.fn(),
    setNativeCookie: vi.fn(),
}));
vi.mock('@/services/localCoverReadyEvent', () => ({ announceLocalCoverReady: state.announce }));

const origin = 'https://nas.synthetic.test:8443';
const cover = `${origin}/music/api/v1/static/cover?coverId=synthetic`;
const songOf = (url = cover, providerId = 'feiniu'): SongResult => ({
    id: 'synthetic-song', name: 'Synthetic', artists: [], durationMs: 1000,
    album: { id: 'synthetic-album', name: 'Synthetic', coverUrl: url },
    sourceRef: { kind: 'online', providerId, mediaId: 'synthetic-song' },
} as SongResult);
let sequence = 0;
let plugin: {
    registerScopedRemoteAudio: ReturnType<typeof vi.fn>;
    registerRemoteAudio: ReturnType<typeof vi.fn>;
    unregisterRemoteAudio: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    vi.resetModules();
    state.values.clear();
    state.values.set('server', origin);
    state.values.set('token', 'SYNTHETIC_SESSION_A');
    state.values.set('user', '{"id":"synthetic-a"}');
    state.announce.mockReset();
    sequence = 0;
    plugin = {
        registerScopedRemoteAudio: vi.fn(async () => ({ proxied: true, url: `http://127.0.0.1:45678/remote-audio/synthetic-${++sequence}` })),
        registerRemoteAudio: vi.fn(async () => ({ proxied: true, url: 'http://127.0.0.1:45678/remote-audio/legacy' })),
        unregisterRemoteAudio: vi.fn(async () => ({})),
    };
    vi.stubGlobal('window', { Capacitor: { Plugins: { FoliaNative: plugin } } });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const load = () => import('@/services/onlineMusic/onlineCoverFallback');
const fill = async (song: SongResult) => {
    const api = await load();
    await api.backfillSongCovers([song as UnifiedSong]);
    return api.resolveProxiedSongCover(song, song.album!.coverUrl!);
};

describe('cover credential origin boundary', () => {
    it('registers the configured NAS with explicit origin and no permissive legacy call', async () => {
        const song = songOf();
        expect(await fill(song)).toContain('/remote-audio/synthetic-1');
        expect(plugin.registerScopedRemoteAudio).toHaveBeenCalledExactlyOnceWith({
            url: cover, credentialOrigin: origin, headers: { Cookie: 'music-token=SYNTHETIC_SESSION_A' },
        });
        expect(plugin.registerRemoteAudio).not.toHaveBeenCalled();
        expect(song.album!.coverUrl).toBe(cover);
        await fill(song);
        expect(plugin.registerScopedRemoteAudio).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['other host', 'https://other.synthetic.test:8443/music/api/v1/static/cover'],
        ['subdomain', 'https://child.nas.synthetic.test:8443/music/api/v1/static/cover'],
        ['host suffix', 'https://nas.synthetic.test.other.test:8443/music/api/v1/static/cover'],
        ['scheme', 'http://nas.synthetic.test:8443/music/api/v1/static/cover'],
        ['port', 'https://nas.synthetic.test/music/api/v1/static/cover'],
        ['userinfo', 'https://synthetic@nas.synthetic.test:8443/music/api/v1/static/cover'],
        ['query only', `${origin}/image?next=/music/api/v1/static/cover`],
        ['relative', '/music/api/v1/static/cover'],
        ['invalid', 'not a URL/music/api/v1/static/cover'],
        ['data', 'data:text/plain,/music/api/v1/static/cover'],
    ])('does not register %s metadata', async (_name, url) => {
        const song = songOf(url);
        expect(await fill(song)).toBe(url);
        const api = await load();
        expect(api.resolveProxiedSongCover(song, url)).toBe(url);
        expect(plugin.registerRemoteAudio).not.toHaveBeenCalled();
        expect(plugin.registerScopedRemoteAudio).not.toHaveBeenCalled();
    });

    it.each(['qq', 'netease', 'local'])('does not attach NAS credentials to %s songs', async (provider) => {
        const song = songOf(cover, provider);
        if (provider === 'local') song.sourceRef = { kind: 'local', mediaId: 'synthetic' } as SongResult['sourceRef'];
        expect(await fill(song)).toBe(cover);
        expect(plugin.registerRemoteAudio).not.toHaveBeenCalled();
        expect(plugin.registerScopedRemoteAudio).not.toHaveBeenCalled();
    });

    it('uses the transport default HTTP port and normalized HTTPS default port', async () => {
        const transport = await import('@/services/onlineMusic/feiniuTransport');
        state.values.set('server', 'nas.synthetic.test');
        const httpCover = 'http://nas.synthetic.test:5666/music/api/v1/static/cover';
        expect(await fill(songOf(httpCover))).toContain('/remote-audio/');
        expect(plugin.registerScopedRemoteAudio.mock.calls[0][0].credentialOrigin).toBe('http://nas.synthetic.test:5666');
        state.values.set('server', 'https://nas.synthetic.test:443');
        const session = transport.getFeiniuResourceSession()!;
        expect(transport.isFeiniuCoverUrl('https://nas.synthetic.test/music/api/v1/static/cover', session)).toBe(true);
        expect(transport.isFeiniuCoverUrl(httpCover, session)).toBe(false);
    });

    it('does not negatively cache an unavailable safe bridge or use the old bridge', async () => {
        const safe = plugin.registerScopedRemoteAudio;
        delete (plugin as Partial<typeof plugin>).registerScopedRemoteAudio;
        const song = songOf();
        expect(await fill(song)).toBe(cover);
        expect(plugin.registerRemoteAudio).not.toHaveBeenCalled();
        plugin.registerScopedRemoteAudio = safe;
        expect(await fill(song)).toContain('/remote-audio/synthetic-1');
    });

    it('does not register without a session', async () => {
        state.values.delete('token');
        expect(await fill(songOf())).toBe(cover);
        expect(plugin.registerScopedRemoteAudio).not.toHaveBeenCalled();
        expect(plugin.registerRemoteAudio).not.toHaveBeenCalled();
    });
});

describe('cover session lifecycle', () => {
    it('revokes old cached registrations on account/token/relay changes and logout', async () => {
        const api = await load();
        const transport = await import('@/services/onlineMusic/feiniuTransport');
        const song = songOf();
        const first = await fill(song);
        state.values.set('token', 'SYNTHETIC_SESSION_B');
        state.values.set('user', '{"id":"synthetic-b"}');
        const second = await fill(song);
        expect(second).not.toBe(first);
        expect(plugin.unregisterRemoteAudio).toHaveBeenCalledWith({ url: first });
        expect(plugin.registerScopedRemoteAudio.mock.calls[1][0].headers.Cookie).toBe('music-token=SYNTHETIC_SESSION_B');
        transport.setFeiniuRelayMode(true);
        expect(plugin.unregisterRemoteAudio).toHaveBeenCalledWith({ url: second });
        const third = await fill(song);
        expect(plugin.registerScopedRemoteAudio.mock.calls[2][0].headers.Cookie).toContain('; mode=relay');
        transport.clearFeiniuSession();
        expect(plugin.unregisterRemoteAudio).toHaveBeenCalledWith({ url: third });
        expect(api.resolveProxiedSongCover(song, cover)).toBe(cover);
    });

    it('invalidates on account identity changes even if the credential is unchanged', async () => {
        const transport = await import('@/services/onlineMusic/feiniuTransport');
        const first = await fill(songOf());
        transport.rememberFeiniuUser({ id: 'synthetic-b', nickname: 'Synthetic B' });
        expect(plugin.unregisterRemoteAudio).toHaveBeenCalledWith({ url: first });
        expect(await fill(songOf())).not.toBe(first);
    });

    it('bounds the renderer cache and revokes an evicted registration', async () => {
        const first = await fill(songOf());
        for (let index = 0; index < 64; index++) await fill(songOf(`${cover}&synthetic=${index}`));
        expect(plugin.unregisterRemoteAudio).toHaveBeenCalledWith({ url: first });
        expect(await fill(songOf())).not.toBe(first);
        expect(plugin.registerScopedRemoteAudio).toHaveBeenCalledTimes(66);
    });

    it('server changes clear old credentials and revoke proxies immediately', async () => {
        const transport = await import('@/services/onlineMusic/feiniuTransport');
        const old = await fill(songOf());
        transport.setFeiniuServerUrl('https://new-nas.synthetic.test');
        expect(plugin.unregisterRemoteAudio).toHaveBeenCalledWith({ url: old });
        expect(state.values.has('token')).toBe(false);
        expect(transport.getFeiniuResourceSession()).toBeNull();
        expect(await fill(songOf())).toBe(cover);
    });

    it('deduplicates pending registration and revokes a late response after logout', async () => {
        let finish!: (value: { proxied: boolean; url: string }) => void;
        plugin.registerScopedRemoteAudio.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const api = await load();
        const transport = await import('@/services/onlineMusic/feiniuTransport');
        const song = songOf();
        api.resolveProxiedSongCover(song, cover);
        api.resolveProxiedSongCover(song, cover);
        expect(plugin.registerScopedRemoteAudio).toHaveBeenCalledTimes(1);
        transport.clearFeiniuSession();
        const late = 'http://127.0.0.1:45678/remote-audio/late';
        finish({ proxied: true, url: late });
        await vi.waitFor(() => expect(plugin.unregisterRemoteAudio).toHaveBeenCalledWith({ url: late }));
        expect(song.album!.coverUrl).toBe(cover);
        expect(state.announce).not.toHaveBeenCalled();
    });
});
