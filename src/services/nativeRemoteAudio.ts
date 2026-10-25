// src/services/nativeRemoteAudio.ts
/**
 * 把远端音频地址换成安卓本地回环服务的地址（只有真机生效）。
 *
 * 为什么需要它：播放器给 <audio> 挂了 `crossOrigin="anonymous"`，而某些 CDN
 * （目前就是波点用的 Kuwo）**根本不下发 Access-Control-Allow-Origin** ——
 * 同源检查在最前面就把字节挡掉了，报出来的却是一句毫无特征的
 * `MEDIA_ELEMENT_ERROR: Format error` / "The element has no supported sources"。
 *
 * 原生侧（LocalAudioServer）代为转发，回包带 `ACAO: *`，Range 原样透传，
 * 于是拖进度条也不受影响。非安卓或换地址失败时原样返回，让播放照旧直连一次 ——
 * 代理只是为了让"本来能播的"能播，不该因为代理本身出问题就把整首歌判死。
 */

type RegisterRemoteAudioResponse = {
    url?: string;
    proxied?: boolean;
    error?: string;
};

type NativePlugin = {
    unregisterRemoteAudio?: (options: { url: string }) => Promise<unknown>;
    registerScopedRemoteAudio?: (options: {
        url: string;
        headers: Record<string, string>;
        credentialOrigin: string;
    }) => Promise<RegisterRemoteAudioResponse>;
    registerRemoteAudio?: (options: {
        url: string;
        /** 转发时要附带的请求头（飞牛的 music-token 就走这里）；老版本插件没有这个参数。 */
        headers?: Record<string, string>;
        /** 允许白名单之外的主机：自建服务的地址是用户自己填的，进不了那份白名单。 */
        allowAnyHost?: boolean;
    }) => Promise<RegisterRemoteAudioResponse>;
};

const getPlugin = (): NativePlugin | null => (
    // 这个文件会被没有 window 的环境拉进去跑（波点的取地址那条链在 worker / 单测里也走得到）：
    // 直接读 window 抛的是 ReferenceError，不是 undefined —— 下面的 `?.` 对它无能为力，
    // 波点整个取地址就死在这一句上。先问 window 在不在。
    typeof window === 'undefined'
        ? null
        : ((window as any).Capacitor?.Plugins?.FoliaNative ?? null)
);

/** 已经是本机回环地址了，不用再套一层。 */
const isLoopbackAudio = (value: string): boolean => {
    try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    } catch {
        return false;
    }
};

/** 旧插件没有安全注册入口时不降级到任意主机注册。 */
export const proxyNativeScopedResourceUrl = async (
    url: string,
    options: { headers: Record<string, string>; credentialOrigin: string },
): Promise<string> => {
    try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== options.credentialOrigin
            || parsed.username || parsed.password) return url;
        const plugin = getPlugin();
        if (!plugin?.registerScopedRemoteAudio || !plugin.unregisterRemoteAudio) return url;
        const result = await plugin.registerScopedRemoteAudio({ url, ...options });
        return result?.proxied === true && result.url ? result.url : url;
    } catch {
        return url;
    }
};

export const unregisterNativeRemoteAudioUrl = async (url: string): Promise<void> => {
    try {
        await getPlugin()?.unregisterRemoteAudio?.({ url });
    } catch { /* 撤销失败不能把旧地址重新写回歌曲。 */ }
};

export const proxyNativeRemoteAudioUrl = async (
    url: string | null | undefined,
    options: { headers?: Record<string, string>; allowAnyHost?: boolean } = {},
): Promise<string> => {
    const value = String(url || '').trim();
    if (!value) return '';
    // 本地文件（blob / 回环服务自己发的）本来就同源，套代理纯属多此一举。
    if (value.startsWith('blob:') || value.startsWith('data:') || isLoopbackAudio(value)) return value;

    const plugin = getPlugin();
    if (!plugin?.registerRemoteAudio) return value;

    try {
        const response = await plugin.registerRemoteAudio({
            url: value,
            ...(options.headers && Object.keys(options.headers).length > 0 ? { headers: options.headers } : {}),
            ...(options.allowAnyHost ? { allowAnyHost: true } : {}),
        });
        const proxied = typeof response?.url === 'string' && response.url ? response.url : value;
        if (response?.proxied !== true) return value;
        return proxied;
    } catch {
        return value;
    }
};
