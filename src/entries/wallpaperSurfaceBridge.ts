import { applyPushedPhoneInsets } from '../services/phoneInsets';
import type { WallpaperPayload, WallpaperTimedLine } from './wallpaperSurfaceTypes';

// src/entries/wallpaperSurfaceBridge.ts
// The page's copy of what the native side pushes: the last payload, the push channels and the
// subscribers. Module state, because remounts across a song hand-off must not lose it.

/** 原生推下来的最后一个快照。 */
let latest: WallpaperPayload = { positionMs: 0, playing: false };
let receivedAtMs = performance.now();
/**
 * 「第一帧已经画出来了」在**页面这一级**的记住。
 *
 * 必须是模块级的，不能是组件里的 useState：切歌的那一瞬 App 会先推一份空数据
 * （歌名还没到），`hasData` 变假 → 组件返回 null → 再挂载时 state 回到 false →
 * 舞台又从 opacity 0 开始淡入一次 —— 用户看到的就是「叠层突然消失，然后又出现」。
 * 淡入只应该发生在这份页面**第一次**画出内容的时候，之后一律保持全不透明。
 */
let contentPainted = false;
const subscribers = new Set<() => void>();

/**
 * 上一份**非空**的数据，以及它是什么时候到的。
 *
 * 换歌是两步走：App 先推「新歌名 + 还没有歌词」（歌词是异步解析的），
 * 隔几百毫秒再推一次带时间轴的。那一段空档里页面如果照着"没有数据"处理，
 * 内容会先消失、再重新出现 —— 就是用户说的「叠层突然消失然后出现」。
 *
 * 所以空档里沿用上一份（**只在 3 秒之内**）：超过这个时长说明这首歌真的没歌词
 * （纯音乐），那时候该走占位/收起的路径，不能一直挂着上一首的歌词。
 */
let lastGoodLines: WallpaperTimedLine[] | null = null;
let lastGoodTitle = '';
let lastGoodAt = 0;
const STALE_FALLBACK_MS = 3000;

window.__foliaWallpaperPush = (incoming) => {
    let payload = incoming;
    if (!payload || typeof payload !== 'object') return;
    const now = performance.now();
    if ((payload.lines?.length ?? 0) > 0) {
        lastGoodLines = payload.lines ?? null;
        if (payload.title) lastGoodTitle = payload.title;
        lastGoodAt = now;
    } else if (now - lastGoodAt < STALE_FALLBACK_MS && (lastGoodLines || lastGoodTitle)) {
        // 空档：补上上一份内容，画面不做任何变化。
        payload = {
            ...payload,
            title: payload.title || lastGoodTitle,
            lines: lastGoodLines ?? payload.lines,
        };
    }
    /*
     * 封面走的是单独那条通道，整包里通常不带这两个字段 ——
     * 不能让整包把已经到位的封面冲掉（那会让封面在每次换歌推送后又变回「没有」）。
     */
    if (!payload.coverUrl && !payload.cover && (latest.coverUrl || latest.cover)) {
        payload = { ...payload, coverUrl: latest.coverUrl, cover: latest.cover };
    }
    /*
     * 安全区必须在**通知订阅者之前**落下去。
     *
     * 叠层这一层没有 Capacitor 桥，量不到自己的安全区（见 WallpaperPayload.insets）。
     * 商籁的场景是收到数据之后才建的 —— 描述那一行在建场景那一刻读 `getPhoneInsets().top`，
     * 晚了就白推一次，得等下一次换歌（重建场景）才挪下来。
     */
    if (payload.insets) {
        applyPushedPhoneInsets(payload.insets);
    }
    latest = payload;
    receivedAtMs = performance.now();
    window.__foliaWallpaperPushCount = (window.__foliaWallpaperPushCount ?? 0) + 1;
    window.__foliaWallpaperLastTitle = payload.title ?? '';
    window.__foliaWallpaperLatest = payload;
    window.__foliaWallpaperReceivedAt = receivedAtMs;
    subscribers.forEach(notify => notify());
};

/**
 * 封面单独那条通道。
 *
 * 写在 `latest` 上而不是另开一份 state：封面只是这幅画面里的一个字段，
 * 和歌词/主题走同一份快照，组件那边才不会拿到两套互相打架的数据。
 */
window.__foliaWallpaperPushCover = (incoming) => {
    if (!incoming || typeof incoming !== 'object') return;
    const url = typeof incoming.url === 'string' && incoming.url ? incoming.url : null;
    const data = typeof incoming.data === 'string' && incoming.data ? incoming.data : null;
    if (!url && !data) return;
    if (latest.coverUrl === url && latest.cover === data) return;
    latest = { ...latest, coverUrl: url, cover: data };
    subscribers.forEach(notify => notify());
};

export const positionMsNow = (): number => {
    if (!latest.playing) return latest.positionMs;
    return latest.positionMs + (performance.now() - receivedAtMs);
};


export const subscribeWallpaperPayload = (notify: () => void) => {
    subscribers.add(notify);
    return () => subscribers.delete(notify);
};

/** 原生推下来的最新一份快照。 */
export const getWallpaperSnapshot = (): WallpaperPayload => latest;

export const isWallpaperContentPainted = () => contentPainted;

export const markWallpaperContentPainted = () => {
    contentPainted = true;
};

