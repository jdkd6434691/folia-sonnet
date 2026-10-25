import type { Line } from '../types';
import { NO_LYRIC_LINES } from '../utils/lyrics/noLyricLines';
import { loadIcuFolia, segmentIcuFolia } from '../utils/lyrics/icuFolia';
import type { WallpaperPayload, WallpaperTimedLine } from './wallpaperSurfaceTypes';

// src/entries/wallpaperSurfaceLines.ts
// Turns the pushed lyric rows into the renderer's Line shape, reusing the cached result while the
// rows are unchanged. Loads icu-folia so the words split the same way as in the app window.

const msToSec = (value: number): number => value / 1000;

/**
 * 把原生推来的那几行转成渲染器认识的 Line。
 *
 * 原生带了逐字轴就用逐字轴（播放器里的 Line.words 是同一份东西），
 * 这时叠层的歌词会**一个字一个字推进**，AI 主题的关键词着色也能落在那几个字上。
 *
 * 拿不到逐字轴才退化成「整行一个词」（只有冷启动、App 还没推过逐字数据那几分钟），
 * 那时候歌词会整段出现 —— 已知的、可以接受的退化。
 */
/**
 * 上次算出来的那份 Line，以及它对应的内容签名。
 *
 * 原生每 200ms 推一次，每次都是**新数组**（JSON 现构造的），于是 `toLines` 每 200ms
 * 产出一份新引用 —— 下游那些按 `lines` 做 memo 的模式（浮名会据此重排整篇文章，
 * 还带一次 96ms 防抖）就跟着每 200ms 重排一次。桌面歌词是要长期挂在桌面上的，
 * 这份开销纯属白烧，而画面在这期间还可能被重排打断（看着就是「一闪」）。
 *
 * 内容没变就还给同一份引用：签名取行数 + 首末行时间 + 首行文本 + 总字数，
 * 这几项一起变才算歌词真的换了。
 */
let lastLinesResult: Line[] = NO_LYRIC_LINES;
let lastLinesKey = '';

/*
 * ⭐叠层这一页是**另一个 document**，主应用烘在每行上的那份分词（`autoWordSegments`，
 * icu-folia 切的）过不来 —— payload 只有文本与逐字轴。少了它，`segmentLyricWords`
 * 只能掉到浏览器的 `Intl.Segmenter`，于是中文切出来的词与播放页 / 状态栏**不是同一套**
 * （英文两边都按空格切，所以只有中文有事）：AI 主题标的关键字因此常常对不上，
 * 表现就是「播放页有 AI 高亮，桌面叠层一点没有」。
 *
 * icu-folia 是随包的（ICU + 中文 jieba + 日文 BudouX），这一页自己加载一份即可，
 * 不用把分词也塞进 payload（那要改原生，还得连带落盘那一套）。
 */
let icuFoliaReady = false;
loadIcuFolia().then(ready => {
    icuFoliaReady = ready;
    // 分词从「没有」变成「有」：缓存的那一版 lines 要作废，下一推（200ms 内）重算。
    lastLinesKey = '';
});

const buildLinesKey = (lines: WallpaperTimedLine[], firstIndex: number): string => {
    const first = lines[0];
    const last = lines[lines.length - 1];
    let charCount = 0;
    for (const line of lines) {
        charCount += line.text.length;
    }
    return `${firstIndex}|${lines.length}|${first?.start ?? 0}|${last?.start ?? 0}|${charCount}|${first?.text ?? ''}`;
};

export const toLines = (payload: WallpaperPayload): Line[] => {
    const lines = payload.lines ?? [];
    if (lines.length === 0) return NO_LYRIC_LINES;
    const key = buildLinesKey(lines, payload.firstIndex ?? 0);
    if (key === lastLinesKey) {
        return lastLinesResult;
    }
    const result = lines.map((line, index) => ({
        id: `wp-${payload.firstIndex ?? 0}-${index}`,
        fullText: line.text,
        startTime: msToSec(line.start),
        endTime: msToSec(line.end),
        translation: line.translation,
        // 与主应用同一套分词（icu-folia）。引擎还没加载好时留空：那时
        // segmentLyricWords 会退回 Intl.Segmenter，行为与改动前一致，不会更差。
        ...(icuFoliaReady ? { autoWordSegments: segmentIcuFolia(line.text) ?? undefined } : {}),
        words: (line.words && line.words.length > 0 ? line.words : [{
            text: line.text,
            start: line.start,
            end: line.end,
        }]).map(word => ({
            text: word.text,
            startTime: msToSec(word.start),
            endTime: msToSec(word.end),
        })),
    }));
    lastLinesKey = key;
    lastLinesResult = result;
    return result;
};

export { msToSec };

