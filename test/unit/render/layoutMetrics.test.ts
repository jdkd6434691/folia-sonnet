import { describe, expect, it } from 'vitest';
import {
    OVERLAP_MIN_PX,
    collectFindings,
    intersectionArea,
    isFixedOcclusion,
    isOverlap,
    isZeroSize,
    occlusionRatio,
    textClipped,
    viewportOverflow,
} from '../../render/layoutMetrics.mjs';

// 布局自检的判定口径都在这里钉住：layoutCheck.mjs 只负责从 DOM 采集矩形。

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('重叠判定', () => {
    it('两个方向都超过阈值才算错位重叠', () => {
        expect(isOverlap(box(0, 0, 100, 40), box(90, 30, 100, 40))).toBe(true);
        expect(isOverlap(box(0, 0, 100, 40), box(97, 30, 100, 40))).toBe(false);
    });

    it('只碰到边不算重叠', () => {
        expect(isOverlap(box(0, 0, 100, 40), box(100, 0, 100, 40))).toBe(false);
        expect(isOverlap(box(0, 0, 100, 40), box(0, 40, 100, 40))).toBe(false);
    });

    it('交集正好等于阈值算重叠，少 0.1px 不算', () => {
        expect(isOverlap(box(0, 0, 100, 40), box(100 - OVERLAP_MIN_PX, 0, 100, 40))).toBe(true);
        expect(isOverlap(box(0, 0, 100, 40), box(100 - OVERLAP_MIN_PX + 0.1, 0, 100, 40))).toBe(false);
    });

    it('包含关系也算重叠，面积按交集算', () => {
        expect(isOverlap(box(0, 0, 200, 80), box(20, 20, 10, 10))).toBe(true);
        expect(intersectionArea(box(0, 0, 100, 40), box(50, 10, 100, 40))).toBe(50 * 30);
    });
});

describe('视口溢出', () => {
    const viewport = { width: 1440, height: 1100 };

    it('正好贴边不算溢出（零容差）', () => {
        expect(viewportOverflow(box(0, 0, 1440, 1100), viewport)).toBeNull();
        expect(viewportOverflow(box(10, 10, 1430, 1090), viewport)).toBeNull();
    });

    it('四条边各自报超出多少像素', () => {
        expect(viewportOverflow(box(-12, -3, 100, 100), viewport)).toEqual({ left: 12, top: 3, right: 0, bottom: 0 });
        expect(viewportOverflow(box(1400, 0, 100, 100), viewport)).toEqual({ left: 0, top: 0, right: 60, bottom: 0 });
    });

    it('零边界容差：多 0.1px 也报，给 1px 容差才放过', () => {
        expect(viewportOverflow(box(0, 0, 1440.1, 1100), viewport)?.right).toBeCloseTo(0.1);
        expect(viewportOverflow(box(0, 0, 1441, 1100), viewport, 1)).toBeNull();
    });
});

describe('零尺寸', () => {
    it('任意一边不足 1px 就算看不见', () => {
        expect(isZeroSize(box(0, 0, 0, 0))).toBe(true);
        expect(isZeroSize(box(10, 10, 0, 24))).toBe(true);
        expect(isZeroSize(box(10, 10, 24, 0.5))).toBe(true);
        expect(isZeroSize(box(10, 10, 1, 1))).toBe(false);
    });
});

describe('文本裁切', () => {
    it('横向滚出 1px 以内不算，超过就报', () => {
        expect(textClipped({ scrollWidth: 101, clientWidth: 100, scrollHeight: 20, clientHeight: 20 })).toBeNull();
        expect(textClipped({ scrollWidth: 120, clientWidth: 100, scrollHeight: 20, clientHeight: 20 }))
            .toEqual({ overflowX: 20, overflowY: 0 });
    });

    it('纵向裁切同样算', () => {
        expect(textClipped({ scrollWidth: 100, clientWidth: 100, scrollHeight: 48, clientHeight: 40 })?.overflowY).toBe(8);
    });
});

describe('固定元素遮挡', () => {
    it('盖住中心且面积过阈值才算', () => {
        expect(isFixedOcclusion(box(100, 100, 200, 100), box(0, 90, 1440, 60))).toBe(true);
        expect(isFixedOcclusion(box(100, 100, 200, 100), box(0, 0, 1440, 120))).toBe(false);
    });

    it('覆盖率按目标面积算', () => {
        expect(occlusionRatio(box(0, 0, 100, 100), box(0, 0, 50, 100))).toBe(0.5);
        expect(occlusionRatio(box(0, 0, 0, 100), box(0, 0, 50, 100))).toBe(0);
    });
});

describe('findings 汇总', () => {
    const viewport = { width: 1000, height: 800 };

    it('父元素包住的可点按钮不算互相重叠', () => {
        const findings = collectFindings({
            viewport,
            clickables: [
                { id: 0, selector: 'card', rect: box(0, 0, 300, 200), ancestorIds: [] },
                { id: 1, selector: 'card > button', rect: box(10, 10, 100, 40), ancestorIds: [0] },
            ],
        });
        expect(findings).toEqual([]);
    });

    it('两个可点元素重叠时给出像素数', () => {
        const findings = collectFindings({
            viewport,
            clickables: [
                { id: 0, selector: 'a', rect: box(0, 0, 100, 40), ancestorIds: [] },
                { id: 1, selector: 'b', rect: box(90, 30, 100, 40), ancestorIds: [] },
            ],
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].kind).toBe('click-overlap');
        expect(findings[0].values).toMatchObject({ width: 10, height: 10 });
    });

    it('溢出容差默认 0.5px：半像素放过，超过才报', () => {
        const half = { viewport, overflow: [{ selector: 'card', rect: box(0, 0, 1000.5, 800) }] };
        expect(collectFindings(half)).toEqual([]);
        const over = { viewport, overflow: [{ selector: 'card', rect: box(0, 0, 1002, 800) }] };
        expect(collectFindings(over).map((finding) => finding.kind)).toEqual(['viewport-overflow']);
    });

    it('固定元素遮挡按遮挡元素聚合，不逐个目标刷屏', () => {
        const blocker = { selector: 'div.player-bar', rect: box(0, 700, 1000, 100) };
        const findings = collectFindings({
            viewport,
            fixedOcclusions: [
                { target: { selector: 'button.play', rect: box(100, 720, 200, 100) }, blocker },
                { target: { selector: 'button.next', rect: box(400, 720, 200, 100) }, blocker },
            ],
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].kind).toBe('fixed-occlusion');
        expect(findings[0].values.coveredTargets).toEqual(['button.play', 'button.next']);
    });

    it('零尺寸的可聚焦元素与文本裁切都会报出来', () => {
        const findings = collectFindings({
            viewport,
            focusables: [{ selector: 'button.icon', rect: box(10, 10, 0, 0) }],
            texts: [{ selector: 'span.title', metrics: { scrollWidth: 120, clientWidth: 100, scrollHeight: 20, clientHeight: 20 } }],
        });
        expect(findings.map((finding) => finding.kind)).toEqual(['focus-zero-size', 'text-clipped']);
    });
});
