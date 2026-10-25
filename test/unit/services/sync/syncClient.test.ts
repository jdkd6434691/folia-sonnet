// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/sync/syncClient.test.ts
// 同步服务的请求走哪条通道。
//
// 同步服务是**用户手填地址**的自建服务，请求还带 `Authorization` 头 —— 在安卓容器里
// 这必然被同源检查掐掉，报出来的是一个毫无特征的 `TypeError: Failed to fetch`，界面上
// 只能显示「连接失败」，从现象几乎反推不到原因。
//
// 所以它必须和 AI 云缓存、字体市场一样走原生 OkHttp 桥（`createAiFetch`）。这里换掉
// 那条桥并断言全局 `fetch` **一次都没被碰过** —— 反过来的实现（走全局 fetch）会让
// 这条测试红。

const { nativeFetch } = vi.hoisted(() => ({ nativeFetch: vi.fn() }));

vi.mock('@/services/aiNativeFetch', () => ({
    createAiFetch: () => nativeFetch,
}));

const { getRemoteState, putRemoteSettings, testSyncConnection } = await import('@/services/sync/syncClient');

const config = {
    provider: 'sync-server',
    enabled: true,
    workerBaseUrl: 'https://sync.example.com/',
    authToken: 'tok-123',
} as const;

const globalFetch = vi.fn();

const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
}) as unknown as Response;

beforeEach(() => {
    nativeFetch.mockReset();
    globalFetch.mockReset();
    vi.stubGlobal('fetch', globalFetch);
    nativeFetch.mockResolvedValue(jsonResponse({}));
});

describe('syncClient 的通道', () => {
    it('goes through the native bridge instead of the global fetch', async () => {
        await testSyncConnection(config);

        expect(nativeFetch).toHaveBeenCalledTimes(1);
        expect(globalFetch).not.toHaveBeenCalled();
    });

    /* 尾斜杠不该拼出 `//health`：那是另一条路径，服务端会 404。 */
    it('builds the url off the configured base', async () => {
        await testSyncConnection(config);

        expect(String(nativeFetch.mock.calls[0][0])).toBe('https://sync.example.com/health');
    });

    it('carries the bearer token on every request', async () => {
        await getRemoteState(config);

        const init = nativeFetch.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    });

    it('sends a JSON body through the same channel', async () => {
        const record = { schemaVersion: 1, updatedAt: '2026-01-01T00:00:00Z', data: { visualizerMode: 'classic' } };
        nativeFetch.mockResolvedValue(jsonResponse({ protocol: 'settings-cas-v1', accepted: true, revision: 'a'.repeat(64), record }));
        await putRemoteSettings(config, record, null);

        const [url, init] = nativeFetch.mock.calls[0] as [string, RequestInit];
        expect(String(url)).toBe('https://sync.example.com/settings');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(String(init.body))).toEqual({ ...record, expectedRevision: null });
    });

    /* 服务端报错要原样抛出去，别被吞成「有响应但没内容」。 */
    it('throws with the status when the server refuses', async () => {
        nativeFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);

        await expect(getRemoteState(config)).rejects.toThrow('401');
    });
});
