// src/entries/wallpaperSurfaceTheme.ts
// Colour maths for the wallpaper page: the derived secondary colour and the per-frame colour
// easing that keeps a theme change from snapping.

/**
 * 把颜色朝白色混 `ratio`（0~1）。用于从主色派生出一个更亮、仍然同源的次色。
 * 认不出来就原样返回 —— 这里宁可少变也不要给出错误的颜色。
 */
const lightenColor = (color: string, ratio: number): string => {
    const matched = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!matched) return color;
    let hex = matched[1];
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    const channels = [0, 2, 4].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16);
        return Math.round(value + (255 - value) * ratio);
    });
    return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`;
};

const parseHexColor = (color: string): [number, number, number] | null => {
    const matched = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!matched) return null;
    let hex = matched[1];
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
    ];
};

const rgbToHex = (channels: readonly number[]): string =>
    `#${channels.map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;

/**
 * 主题色过渡的时间常数（毫秒）。
 *
 * 换歌时新主题色是**瞬间替换**进 payload 的：直接用的话，整个可视化的配色
 * 会从上一首的颜色硬跳到下一首的颜色 —— 用户看到的就是
 * 「一开始还是上一个主题色，然后突然变色」。这里在 rAF 里向目标色平滑逼近，
 * 观感是「颜色流过去」，而不是「换了张皮」。
 */
const THEME_COLOR_TRANSITION_MS = 600;

/**
 * 把当前色朝目标色推进一步（指数逼近，起步快收尾缓，和淡入淡出同一族节奏）。
 * 返回 undefined 表示无需变更；返回 null 表示目标为空（交给主题兜底）。
 * 首份颜色直接落位（不从前一状态或黑色渐变过来）；剩余距离小到一步以内时贴齐，
 * 不让浮点尾数拖着永远不结束。
 */
const stepColorTowards = (
    current: string | null,
    targetHex: string | undefined,
    dtMs: number,
): string | null | undefined => {
    const target = targetHex && targetHex.trim() ? targetHex : null;
    if (target === current) return undefined;
    if (current === null || target === null) return target;
    const from = parseHexColor(current);
    const to = parseHexColor(target);
    if (!from || !to) return target;
    const t = Math.min(0.5, dtMs / THEME_COLOR_TRANSITION_MS);
    const mixed = from.map((channel, index) => channel + (to[index] - channel) * t);
    const remaining = Math.max(...to.map((channel, index) => Math.abs(channel - mixed[index])));
    if (remaining < 1.5) return target;
    return rgbToHex(mixed);
};

export { lightenColor, stepColorTowards };

