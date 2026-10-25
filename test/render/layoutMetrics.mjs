// test/render/layoutMetrics.mjs
// 布局自检的纯几何判定：只吃矩形和尺寸数字，不碰 DOM，单测与 layoutCheck.mjs 共用同一份口径。

// 相邻元素的边框经常只差 1–2px（阴影、圆角、亚像素取整），小于这个数的交集不算错位重叠。
export const OVERLAP_MIN_PX = 4;
// 文本多滚出 1px 以内是字体度量误差，不算裁切。
export const TEXT_CLIP_TOLERANCE_PX = 1;
// 固定元素要盖住目标中心、且盖住这个比例以上才报，避免停在边缘的工具栏把整屏元素都算成被遮挡。
export const FIXED_OCCLUSION_MIN_RATIO = 0.15;

// DOMRect 与普通对象都接受；缺字段按 0，负宽高夹到 0（display:none 的元素量出来是 0）。
export function toBox(rect) {
    return {
        x: Number(rect?.x ?? 0),
        y: Number(rect?.y ?? 0),
        width: Math.max(0, Number(rect?.width ?? 0)),
        height: Math.max(0, Number(rect?.height ?? 0)),
    };
}

export function intersection(a, b) {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return { width: Math.max(0, width), height: Math.max(0, height) };
}

export function intersectionArea(a, b) {
    const box = intersection(a, b);
    return box.width * box.height;
}

// 两个方向都至少相交 minPx 才算错位：只贴边、或者只压住 2–3px 的滚动条式相交都不报。
export function isOverlap(a, b, minPx = OVERLAP_MIN_PX) {
    const box = intersection(a, b);
    return box.width >= minPx && box.height >= minPx;
}

// 返回四条边各超出视口多少像素；都在容差内时返回 null。正好贴边不算溢出。
export function viewportOverflow(box, viewport, tolerancePx = 0) {
    const overflow = {
        left: Math.max(0, -box.x - tolerancePx),
        top: Math.max(0, -box.y - tolerancePx),
        right: Math.max(0, box.x + box.width - viewport.width - tolerancePx),
        bottom: Math.max(0, box.y + box.height - viewport.height - tolerancePx),
    };
    return overflow.left || overflow.top || overflow.right || overflow.bottom ? overflow : null;
}

// 可聚焦元素看不见时键盘焦点也看不见：任意一边不足 1px 就按零尺寸处理。
export function isZeroSize(box) {
    return box.width < 1 || box.height < 1;
}

// scrollWidth 比 clientWidth 大才说明内容被裁；1px 容差留给字体度量的取整误差。
export function textClipped(metrics, tolerancePx = TEXT_CLIP_TOLERANCE_PX) {
    const overflowX = Number(metrics?.scrollWidth ?? 0) - Number(metrics?.clientWidth ?? 0);
    const overflowY = Number(metrics?.scrollHeight ?? 0) - Number(metrics?.clientHeight ?? 0);
    if (overflowX <= tolerancePx && overflowY <= tolerancePx) return null;
    return { overflowX, overflowY };
}

export function centerOf(box) {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function containsPoint(box, point) {
    return point.x >= box.x && point.x <= box.x + box.width
        && point.y >= box.y && point.y <= box.y + box.height;
}

export function occlusionRatio(target, blocker) {
    const area = target.width * target.height;
    if (area <= 0) return 0;
    return intersectionArea(target, blocker) / area;
}

// 固定元素盖住可点元素中心（elementFromPoint 已经确认它确实在最上层）才算遮挡。
export function isFixedOcclusion(target, blocker, minRatio = FIXED_OCCLUSION_MIN_RATIO) {
    return containsPoint(blocker, centerOf(target)) && occlusionRatio(target, blocker) >= minRatio;
}

const KIND_ORDER = ['viewport-overflow', 'click-overlap', 'focus-zero-size', 'text-clipped', 'fixed-occlusion'];
const formatPx = (value) => Math.round(value * 10) / 10 + 'px';

function describeOverflow(overflow) {
    const parts = [];
    if (overflow.top) parts.push('上 ' + formatPx(overflow.top));
    if (overflow.right) parts.push('右 ' + formatPx(overflow.right));
    if (overflow.bottom) parts.push('下 ' + formatPx(overflow.bottom));
    if (overflow.left) parts.push('左 ' + formatPx(overflow.left));
    return '超出视口：' + parts.join('、');
}

function groupFixedOcclusions(pairs, minRatio) {
    const byBlocker = new Map();
    for (const pair of pairs) {
        const target = toBox(pair.target?.rect);
        const blocker = toBox(pair.blocker?.rect);
        if (!isFixedOcclusion(target, blocker, minRatio)) continue;
        const key = pair.blocker.selector;
        const entry = byBlocker.get(key) ?? { blocker, targets: [], maxCoverage: 0 };
        entry.targets.push(pair.target.selector);
        entry.maxCoverage = Math.max(entry.maxCoverage, occlusionRatio(target, blocker));
        byBlocker.set(key, entry);
    }
    return byBlocker;
}

// DOM 采集结果 -> findings。浏览器（layoutCheck.mjs）只负责量矩形，是否算问题全在这里判定。
export function collectFindings(input, options = {}) {
    const viewport = toBox(input.viewport);
    const overflowTolerancePx = options.overflowTolerancePx ?? 0.5;
    const occlusionMinRatio = options.occlusionMinRatio ?? FIXED_OCCLUSION_MIN_RATIO;
    const findings = [];

    for (const item of input.overflow ?? []) {
        const rect = toBox(item.rect);
        const overflow = viewportOverflow(rect, viewport, overflowTolerancePx);
        if (!overflow) continue;
        findings.push({
            kind: 'viewport-overflow',
            selector: item.selector,
            detail: describeOverflow(overflow),
            values: { rect, overflow },
        });
    }

    const clickables = (input.clickables ?? []).map((item, index) => ({ ...item, id: item.id ?? index }));
    for (let i = 0; i < clickables.length; i += 1) {
        for (let j = i + 1; j < clickables.length; j += 1) {
            const a = clickables[i];
            const b = clickables[j];
            // 父元素自己可点、里面又有可点按钮是正常结构，不是错位。
            if ((a.ancestorIds ?? []).includes(b.id) || (b.ancestorIds ?? []).includes(a.id)) continue;
            const rectA = toBox(a.rect);
            const rectB = toBox(b.rect);
            const overlap = intersection(rectA, rectB);
            if (!isOverlap(rectA, rectB)) continue;
            findings.push({
                kind: 'click-overlap',
                selector: a.selector + ' ⇄ ' + b.selector,
                detail: '与 ' + b.selector + ' 重叠 ' + formatPx(overlap.width) + '×' + formatPx(overlap.height),
                values: { width: overlap.width, height: overlap.height, area: overlap.width * overlap.height, rectA, rectB },
            });
        }
    }

    for (const item of input.focusables ?? []) {
        const rect = toBox(item.rect);
        if (!isZeroSize(rect)) continue;
        findings.push({
            kind: 'focus-zero-size',
            selector: item.selector,
            detail: '可聚焦元素尺寸 ' + formatPx(rect.width) + '×' + formatPx(rect.height) + '，键盘聚焦时看不到焦点',
            values: { rect },
        });
    }

    for (const item of input.texts ?? []) {
        const clipped = textClipped(item.metrics);
        if (!clipped) continue;
        findings.push({
            kind: 'text-clipped',
            selector: item.selector,
            detail: '文本被裁切：横向多出 ' + formatPx(clipped.overflowX) + '，纵向多出 ' + formatPx(clipped.overflowY),
            values: { ...item.metrics, ...clipped },
        });
    }

    for (const [selector, entry] of groupFixedOcclusions(input.fixedOcclusions ?? [], occlusionMinRatio)) {
        const listed = entry.targets.slice(0, 3).join('、');
        findings.push({
            kind: 'fixed-occlusion',
            selector,
            detail: '固定元素遮挡了 ' + entry.targets.length + ' 个可点元素（最高覆盖 ' + Math.round(entry.maxCoverage * 100) + '%）：' + listed + (entry.targets.length > 3 ? ' 等' : ''),
            values: { blocker: entry.blocker, coveredTargets: entry.targets, maxCoverage: entry.maxCoverage },
        });
    }

    findings.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.selector.localeCompare(b.selector));
    return findings;
}
