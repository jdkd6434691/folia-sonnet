import { useEffect, useMemo, useState, type RefObject } from 'react';
import { squareGridCardBox } from '../shared/gridCardLayout';

// src/library/suites/grid/collection/useGridViewLayout.ts
// GridView 的断点布局：容器尺寸、卡片盒、裁剪半径、渲染半径与卡片帧参数。原 GridView.tsx 顶部的
// 断点表与这一段 memo 原样搬出（数值与依赖数组不变）。

// reads as "pick a breakpoint, then apply the square-card option" rather than hiding the
// table inside it.
const resolveGridViewCardBox = (width: number) => {
    if (width < 768) {
        // Mobile/Narrow
        return {
            cardWidth: 180,
            cardHeight: 280,
            spacingX: 205,
            spacingY: 270,
            maxDistance: 420,
            lodStart: 280,
            lodEnd: 320,
        };
    } else if (width < 1440) {
        // Desktop
        return {
            cardWidth: 220,
            cardHeight: 330,
            spacingX: 250,
            spacingY: 320,
            maxDistance: 500,
            lodStart: 340,
            lodEnd: 385,
        };
    } else if (width < 2000) {
        // Large Desktop
        return {
            cardWidth: 250,
            cardHeight: 375,
            spacingX: 285,
            spacingY: 365,
            maxDistance: 580,
            lodStart: 400,
            lodEnd: 450,
        };
    } else {
        // Ultra Desktop
        return {
            cardWidth: 280,
            cardHeight: 420,
            spacingX: 320,
            spacingY: 410,
            maxDistance: 660,
            lodStart: 450,
            lodEnd: 510,
        };
    }
};

const GRID_VIEW_RENDER_BUFFER_FACTOR = 0.75;
const GRID_VIEW_CARD_VISIBILITY_BUFFER = 96;

export interface GridViewLayoutParams {
    containerRef: RefObject<HTMLDivElement | null>;
    /** 方卡只在满幅封面下成立（见 GridView 里的说明）。 */
    squareCards: boolean;
    minCardScale: number;
    minCardOpacity: number;
}

export const useGridViewLayout = ({
    containerRef,
    squareCards,
    minCardScale,
    minCardOpacity,
}: GridViewLayoutParams) => {
    // Track responsive container size to scale grid card dimensions dynamically
    const [containerSize, setContainerSize] = useState(() => {
        if (typeof window === 'undefined') {
            return { width: 0, height: 0 };
        }
        return { width: window.innerWidth, height: window.innerHeight };
    });

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const updateContainerSize = () => {
            const nextWidth = element.clientWidth;
            const nextHeight = element.clientHeight;

            setContainerSize((prev) => (
                prev.width === nextWidth && prev.height === nextHeight
                    ? prev
                    : { width: nextWidth, height: nextHeight }
            ));
        };

        updateContainerSize();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateContainerSize);
            return () => window.removeEventListener('resize', updateContainerSize);
        }

        const observer = new ResizeObserver(() => {
            updateContainerSize();
        });
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    // Layout values for different container size breakpoints
    const layoutConfig = useMemo(() => {
        const width = containerSize.width;
        const box = resolveGridViewCardBox(width);
        return squareCards ? squareGridCardBox(box) : box;
    }, [containerSize.width, squareCards]);

    // Dynamically calculate visible clipping radius centered on (0,0) viewport coordinates
    const clipRadius = useMemo(() => {
        const { width, height } = containerSize;
        const { cardWidth, cardHeight } = layoutConfig;
        const viewportRadius = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2);
        const cardRadius = Math.sqrt(cardWidth ** 2 + cardHeight ** 2) / 2;
        return viewportRadius + cardRadius + 200; // 200px buffer to prevent visual pop-in during fast drags
    }, [containerSize, layoutConfig]);

    const renderRadius = useMemo(() => (
        clipRadius + Math.max(layoutConfig.spacingX, layoutConfig.spacingY) * GRID_VIEW_RENDER_BUFFER_FACTOR
    ), [clipRadius, layoutConfig.spacingX, layoutConfig.spacingY]);

    const renderRing = useMemo(() => (
        Math.ceil(renderRadius / Math.min(layoutConfig.spacingX, layoutConfig.spacingY)) + 1
    ), [layoutConfig.spacingX, layoutConfig.spacingY, renderRadius]);

    const cardFrameOptions = useMemo(() => ({
        clipRadius,
        maxDistance: layoutConfig.maxDistance,
        lodStart: layoutConfig.lodStart,
        lodEnd: layoutConfig.lodEnd,
        viewportWidth: containerSize.width,
        viewportHeight: containerSize.height,
        cardWidth: layoutConfig.cardWidth,
        cardHeight: layoutConfig.cardHeight,
        visibilityBuffer: GRID_VIEW_CARD_VISIBILITY_BUFFER,
        minScale: minCardScale,
        minOpacity: minCardOpacity,
    }), [
        clipRadius,
        containerSize.height,
        containerSize.width,
        layoutConfig.cardHeight,
        layoutConfig.cardWidth,
        layoutConfig.lodEnd,
        layoutConfig.lodStart,
        layoutConfig.maxDistance,
        minCardOpacity,
        minCardScale,
    ]);


    return { containerSize, layoutConfig, clipRadius, cardFrameOptions, renderRadius, renderRing };
};
