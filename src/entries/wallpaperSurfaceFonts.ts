import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { getStoredUploadedLyricsFont } from '../services/customLyricsFont';

// src/entries/wallpaperSurfaceFonts.ts
// Registers the lyrics font in this document. FontFace is per document, so the app window's
// registrations mean nothing here - see the note in the entry file.

/*
 * 歌词字体。
 *
 * 叠层是**另一个 document**：主窗口那边用 `FontFace` 注册的字体在这里一个都不存在
 * （FontFace 是按 document 注册的，localStorage / IndexedDB 同源共享也不管用）。
 * 而主题里的 `fontFamily` 写的正是那个名字 —— 于是叠层的歌词永远落在兜底字体上，
 * 看着就是「桌面叠层歌词没有[字体]」。所以这一页得自己再注册一遍。
 *
 * 两个来路：
 *  - **跟随播放页**：播放页那个字体是存到 IndexedDB 里的（同源共享，这一页读得到），
 *    按它自己的族名注册，主题里的名字正好对上，不需要额外覆盖。
 *  - **单独**：那份是原生私有目录里的文件，网页够不着 —— 由原生经假域名
 *    `https://localhost/__folia/lyrics-font` 拦下来喂给这一页
 *    （见 WallpaperOverlay.shouldInterceptRequest），注册成一个固定的族名，
 *    再把这个族名覆盖到主题上。
 */
/** 「单独」那份字体经原生取回来的地址。 */
const NATIVE_LYRICS_FONT_URL = '/__folia/lyrics-font';
/** 「单独」那份注册到本 document 时用的族名。 */
const WALLPAPER_LYRICS_FONT_FAMILY = 'FoliaLyricsFont';

type FontFaceConstructorLike = new (family: string, source: ArrayBuffer | ArrayBufferView) => FontFace;

const getFontFaceConstructor = (): FontFaceConstructorLike | null =>
    (globalThis as typeof globalThis & { FontFace?: FontFaceConstructorLike }).FontFace ?? null;

const registerFontFace = async (family: string, source: ArrayBuffer): Promise<boolean> => {
    const FontFaceConstructor = getFontFaceConstructor();
    const documentFonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!FontFaceConstructor || !documentFonts || !source.byteLength) return false;
    try {
        const face = new FontFaceConstructor(family, source);
        await face.load();
        documentFonts.add(face);
        return true;
    } catch {
        // 字体文件坏了 / 不支持：退回主题自带那套，别把整页拖住。
        return false;
    }
};

/**
 * 解析出这一页该用的歌词字体族名。null = 没有可用的自定义字体。
 *
 * 跟着「字体来路」那个设置走（useVisualizerSettingsStore.wallpaperLyricsFontMode）——
 * 它和设置页里「歌词字体」那一组是同一个开关，叠层与主窗口同源，直接读 store 就有。
 */
const resolveLyricsFontFamily = async (mode: 'follow' | 'custom'): Promise<string | null> => {
    if (mode === 'follow') {
        const meta = useTypographySettingsStore.getState().lyricsCustomFont;
        const stored = await getStoredUploadedLyricsFont();
        if (!meta?.fontId || !stored || stored.id !== meta.fontId) return null;
        const buffer = await stored.blob.arrayBuffer();
        return (await registerFontFace(stored.family, buffer)) ? stored.family : null;
    }
    try {
        const response = await fetch(NATIVE_LYRICS_FONT_URL);
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        return (await registerFontFace(WALLPAPER_LYRICS_FONT_FAMILY, buffer))
            ? WALLPAPER_LYRICS_FONT_FAMILY
            : null;
    } catch {
        return null;
    }
};

export { resolveLyricsFontFamily };

