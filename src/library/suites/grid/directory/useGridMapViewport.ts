import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, useMotionValue } from 'framer-motion';
import { useFoliaHexViewport } from '../shared/useFoliaHexViewport';
import { resolveGridMapDisplayIndex } from './gridMapNavigation';
import type { GridMapItem } from './GridMap';

// src/library/suites/grid/directory/GridMap.tsx 的视口：容器尺寸、断点布局、hex 视口、拖拽位移与滚轮。
// 从 GridMap.tsx 原样搬出（含断点数值与依赖数组），GridMap 只拿结果。

export interface GridMapViewportParams {
    /** 容器：尺寸观察与滚轮监听都挂在它上面。 */
    containerRef: React.RefObject<HTMLDivElement | null>;
    /** 卡片数（原 `items.length`：只用到它的长度）。 */
    itemCount: number;
    /** 筛选后的条目：打开地图时按原对象恢复来自 Grid3D 的焦点。 */
    displayItems: GridMapItem[];
    /** 筛选词：恢复焦点的 effect 跟着它重跑（原依赖数组）。 */
    deferredSearchQuery: string;
    /** 从 Grid3D 带过来的焦点条目，挂载时定下。 */
    initialFocusedItem: GridMapItem | undefined;
    /** 卡片帧循环与中心化共用的节流状态，由 GridMap 持有。 */
    pendingTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
    lastUpdateRef: React.MutableRefObject<number>;
}

export const useGridMapViewport = ({
    containerRef,
    itemCount,
    displayItems,
    deferredSearchQuery,
    initialFocusedItem,
    pendingTimeoutRef,
    lastUpdateRef,
}: GridMapViewportParams) => {
    const [focusedIndex, setFocusedIndex] = useState(0);
    const focusedIndexRef = useRef(0);
    const wheelTargetRef = useRef({ x: 0, y: 0 });

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
        if (width < 768) {
            return {
                cardWidth: 180,
                cardHeight: 250,
                spacingX: 205,
                spacingY: 240,
                maxDistance: 420,
            };
        } else if (width < 1440) {
            return {
                cardWidth: 220,
                cardHeight: 290,
                spacingX: 250,
                spacingY: 280,
                maxDistance: 500,
            };
        } else if (width < 2000) {
            return {
                cardWidth: 250,
                cardHeight: 330,
                spacingX: 285,
                spacingY: 320,
                maxDistance: 580,
            };
        } else {
            return {
                cardWidth: 280,
                cardHeight: 370,
                spacingX: 320,
                spacingY: 360,
                maxDistance: 660,
            };
        }
    }, [containerSize.width]);

    // Dynamically calculate visible clipping radius centered on (0,0) viewport coordinates
    const clipRadius = useMemo(() => {
        const { width, height } = containerSize;
        const { cardWidth, cardHeight } = layoutConfig;
        const viewportRadius = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2);
        const cardRadius = Math.sqrt(cardWidth ** 2 + cardHeight ** 2) / 2;
        return viewportRadius + cardRadius + 200;
    }, [containerSize, layoutConfig]);

    const renderRadius = useMemo(() => (
        clipRadius + Math.max(layoutConfig.spacingX, layoutConfig.spacingY) * 1.5
    ), [clipRadius, layoutConfig.spacingX, layoutConfig.spacingY]);

    const renderRing = useMemo(() => (
        Math.ceil(renderRadius / Math.min(layoutConfig.spacingX, layoutConfig.spacingY)) + 1
    ), [layoutConfig.spacingX, layoutConfig.spacingY, renderRadius]);

    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);

    // Synchronize programmatic drag shifts with the scroll position tracker
    useEffect(() => {
        const syncWheelTarget = () => {
            wheelTargetRef.current = { x: dragX.get(), y: dragY.get() };
        };
        const unsubX = dragX.on('change', syncWheelTarget);
        const unsubY = dragY.on('change', syncWheelTarget);
        return () => {
            unsubX();
            unsubY();
        };
    }, [dragX, dragY]);



    useEffect(() => {
        focusedIndexRef.current = focusedIndex;
    }, [focusedIndex]);

    const {
        coords: baseCoords,
        renderedIndexes,
        renderedIndexesRef,
        updateRenderedIndexesForViewport,
    } = useFoliaHexViewport({
        itemCount: displayItems.length,
        spacingX: layoutConfig.spacingX,
        spacingY: layoutConfig.spacingY,
        renderRadius,
        renderRing,
        fallbackIndexRef: focusedIndexRef,
    });

    const dragBounds = useMemo(() => {
        if (baseCoords.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        baseCoords.forEach((c) => {
            if (c.baseX < minX) minX = c.baseX;
            if (c.baseX > maxX) maxX = c.baseX;
            if (c.baseY < minY) minY = c.baseY;
            if (c.baseY > maxY) maxY = c.baseY;
        });

        const bufferX = Math.max(0, containerSize.width / 2 - 2 * layoutConfig.spacingX);
        const bufferY = Math.max(0, containerSize.height / 2 - 2 * layoutConfig.spacingY);

        return {
            left: -maxX - bufferX,
            right: -minX + bufferX,
            top: -maxY - bufferY,
            bottom: -minY + bufferY,
        };
    }, [baseCoords, layoutConfig, containerSize]);

    // Handles mouse wheel events and animates viewport translation offsets
    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (displayItems.length === 0 || event.ctrlKey) return;

        event.preventDefault();
        const deltaScale = (event.deltaMode === 1
            ? 32
            : event.deltaMode === 2
                ? Math.max(containerSize.height, 1)
                : 1) * 2.8;
        const horizontalDelta = event.shiftKey && Math.abs(event.deltaX) < 1
            ? event.deltaY
            : event.deltaX;
        const verticalDelta = event.shiftKey && Math.abs(event.deltaX) < 1
            ? 0
            : event.deltaY;

        const targetX = wheelTargetRef.current.x - horizontalDelta * deltaScale;
        const targetY = wheelTargetRef.current.y - verticalDelta * deltaScale;
        const clampedX = Math.max(dragBounds.left, Math.min(dragBounds.right, targetX));
        const clampedY = Math.max(dragBounds.top, Math.min(dragBounds.bottom, targetY));
        wheelTargetRef.current = { x: clampedX, y: clampedY };

        animate(dragX, clampedX, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
        animate(dragY, clampedY, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
    }, [containerSize.height, dragX, dragY, itemCount, dragBounds]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        element.addEventListener('wheel', handleViewportWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleViewportWheel);
    }, [handleViewportWheel]);

    // Keep the active focusedIndex centered when baseCoords changes on resize
    useEffect(() => {
        if (baseCoords.length > 0 && focusedIndex >= 0 && focusedIndex < baseCoords.length) {
            const targetX = -baseCoords[focusedIndex].baseX;
            const targetY = -baseCoords[focusedIndex].baseY;
            dragX.set(targetX);
            dragY.set(targetY);
            updateRenderedIndexesForViewport(targetX, targetY, true);
        }
    }, [baseCoords, updateRenderedIndexesForViewport]);

    /**
     * Recenter the honeycomb grid viewport on target item coordinate offset.
     */
    const centerOnIndex = (index: number, snap = true) => {
        if (index < 0 || index >= baseCoords.length) return;
        const targetX = -baseCoords[index].baseX;
        const targetY = -baseCoords[index].baseY;

        if (pendingTimeoutRef.current) {
            clearTimeout(pendingTimeoutRef.current);
            pendingTimeoutRef.current = null;
        }
        setFocusedIndex(index);
        focusedIndexRef.current = index;
        lastUpdateRef.current = performance.now();
        updateRenderedIndexesForViewport(targetX, targetY, true);

        if (snap) {
            animate(dragX, targetX, { type: 'spring', stiffness: 220, damping: 28 });
            animate(dragY, targetY, { type: 'spring', stiffness: 220, damping: 28 });
        } else {
            dragX.set(targetX);
            dragY.set(targetY);
        }
    };

    // Restore the source Grid3D focus when opening the map, or use the first filtered result.
    useEffect(() => {
        if (displayItems.length > 0) {
            centerOnIndex(
                resolveGridMapDisplayIndex(displayItems, initialFocusedItem),
                false,
            );
        }
    }, [displayItems.length, deferredSearchQuery]);

    useEffect(() => {
        updateRenderedIndexesForViewport(dragX.get(), dragY.get(), true);
    }, [dragX, dragY, updateRenderedIndexesForViewport]);

    return {
        containerSize,
        layoutConfig,
        clipRadius,
        renderRadius,
        renderRing,
        dragX,
        dragY,
        dragBounds,
        focusedIndex,
        setFocusedIndex,
        focusedIndexRef,
        wheelTargetRef,
        baseCoords,
        renderedIndexes,
        renderedIndexesRef,
        updateRenderedIndexesForViewport,
        centerOnIndex,
    };
};
