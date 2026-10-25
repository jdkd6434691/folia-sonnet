import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { animate, useMotionValue } from 'framer-motion';
import { useFoliaHexViewport } from '../shared/useFoliaHexViewport';
import { resolveGridRestoreIndex, type GridRestoreTarget, type StoredGridViewNavigationState } from '../shared/gridViewRestore';
import type { GridItem } from '../shared/PolaroidCard';
import { registerLibrarySessionFlush, useLibraryBrowseSessionStore } from '../../../core/shared/useLibraryBrowseSessionStore';
import { useLocalCoverPreloader } from '../../../../hooks/useLocalCoverPreloader';

// src/library/suites/grid/collection/useGridViewViewport.ts
// GridView 的视口：拖拽位移、hex 视口、焦点提交、滚轮平移、打开时的恢复与「看到哪首」的记录。
// 原 GridView.tsx 的 memo / effect 原样搬出（依赖数组与逐个 ref 的语义不变）。

export interface GridViewViewportParams {
    containerRef: RefObject<HTMLDivElement | null>;
    layoutConfig: { spacingX: number; spacingY: number };
    containerSize: { width: number; height: number };
    renderRadius: number;
    renderRing: number;
    /** 网格卡（gridItems）：恢复、滚轮与焦点提交都按它的长度。 */
    gridItems: readonly GridItem[];
    /** 拖拽中到达的分页先压住（资源 hook 读同一个 ref）。 */
    isDraggingRef: RefObject<boolean>;
    /** 布局记录的 sessionStorage 键；null 表示这一页不记。 */
    navigationStorageKey: string | null;
    /** 浏览会话 key（「看到哪首」写进会话）。 */
    sessionKey: string;
    initialRestoreTarget: GridRestoreTarget | null;
    /** 条目键 → 下标（findEntryIndex）。 */
    findEntryIndex: (entryKey: string) => number;
    /** 筛选命中的下标；没有筛选时为 null。 */
    matchIndexes: number[] | null;
}

export const useGridViewViewport = ({
    containerRef,
    layoutConfig,
    containerSize,
    renderRadius,
    renderRing,
    gridItems,
    isDraggingRef,
    navigationStorageKey,
    sessionKey,
    initialRestoreTarget,
    findEntryIndex,
    matchIndexes,
}: GridViewViewportParams) => {
    const [focusedIndex, setFocusedIndex] = useState(0);
    const focusedIndexRef = useRef(0);
    const pendingFocusCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wheelTargetRef = useRef({ x: 0, y: 0 });
    const pendingRestoreStateRef = useRef<GridRestoreTarget | null>(null);
    const hasRestoredNavigationRef = useRef(false);

    useEffect(() => {
        if (isDraggingRef.current || pendingFocusCommitTimeoutRef.current) return;
        focusedIndexRef.current = focusedIndex;
    }, [focusedIndex]);

    useEffect(() => {
        hasRestoredNavigationRef.current = false;
        pendingRestoreStateRef.current = initialRestoreTarget;
    }, [initialRestoreTarget]);

    // Coordinate motion values mapping grid drags
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);

    // 「看到哪首」以条目键写进浏览会话（别的 renderer 也认），网格自己的布局另存一份。
    const persistNavigationState = useCallback((index: number) => {
        if (!navigationStorageKey) return;

        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        const focusedEntryKey = gridItems[safeIndex] ? String(gridItems[safeIndex].id) : undefined;
        const state: StoredGridViewNavigationState = {
            focusedEntryKey,
            focusedIndex: safeIndex,
            dragX: dragX.get(),
            dragY: dragY.get(),
        };

        sessionStorage.setItem(navigationStorageKey, JSON.stringify(state));
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, focusedEntryKey ?? null);
    }, [dragX, dragY, gridItems, navigationStorageKey, sessionKey]);

    // 切换 renderer 之前，切换器会让当前网格把焦点写回会话。写的是已提交的焦点（Enter 播放的那张），
    // 不是拖拽帧循环里的 focusedIndexRef：筛选刚变化时那个值可能还来自旧的渲染环。
    const committedFocusIndexRef = useRef(focusedIndex);
    committedFocusIndexRef.current = focusedIndex;
    useEffect(() => registerLibrarySessionFlush(sessionKey, () => persistNavigationState(committedFocusIndexRef.current)), [
        persistNavigationState,
        sessionKey,
    ]);

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

    const {
        coords: baseCoords,
        renderedIndexes,
        renderedIndexesRef,
        updateRenderedIndexesForViewport,
    } = useFoliaHexViewport({
        itemCount: gridItems.length,
        spacingX: layoutConfig.spacingX,
        spacingY: layoutConfig.spacingY,
        renderRadius,
        renderRing,
        fallbackIndexRef: focusedIndexRef,
    });
    // 封面按需取：预加载只需要「视口附近那几个下标」的封面，不必先把整张歌单的 URL 映成数组
    // （5000 首那种列表里，这个数组以前每页都要重建一次）。
    const getItemCoverUrl = useCallback(
        (index: number) => gridItems[index]?.coverUrl,
        [gridItems],
    );
    useLocalCoverPreloader(gridItems.length, getItemCoverUrl, renderedIndexes);

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

    const commitFocusedIndex = useCallback((index = focusedIndexRef.current) => {
        if (pendingFocusCommitTimeoutRef.current) {
            clearTimeout(pendingFocusCommitTimeoutRef.current);
            pendingFocusCommitTimeoutRef.current = null;
        }

        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        focusedIndexRef.current = safeIndex;
        setFocusedIndex(prev => (prev === safeIndex ? prev : safeIndex));
    }, [gridItems.length]);

    const scheduleFocusedIndexCommit = useCallback((delayMs = 180) => {
        if (pendingFocusCommitTimeoutRef.current) {
            clearTimeout(pendingFocusCommitTimeoutRef.current);
        }

        pendingFocusCommitTimeoutRef.current = setTimeout(() => {
            pendingFocusCommitTimeoutRef.current = null;
            commitFocusedIndex();
        }, delayMs);
    }, [commitFocusedIndex]);

    // Keep the focused card centred when the spacing of the cards changes (the window crossed a
    // size breakpoint): the offset the grid stands at then points somewhere else. Cards that
    // join the ones there move nothing: every card keeps its place, and so does the view.
    useEffect(() => {
        if (baseCoords.length > 0 && focusedIndex >= 0 && focusedIndex < baseCoords.length) {
            const targetX = -baseCoords[focusedIndex].baseX;
            const targetY = -baseCoords[focusedIndex].baseY;
            dragX.set(targetX);
            dragY.set(targetY);
            updateRenderedIndexesForViewport(targetX, targetY, true);
        }
    }, [layoutConfig.spacingX, layoutConfig.spacingY]);

    // Recenter the viewport on target item coordinate offset
    const centerOnIndex = (index: number, snap = true) => {
        if (index < 0 || index >= baseCoords.length) return;
        const targetX = -baseCoords[index].baseX;
        const targetY = -baseCoords[index].baseY;

        commitFocusedIndex(index);
        updateRenderedIndexesForViewport(targetX, targetY, true);

        if (snap) {
            animate(dragX, targetX, { type: 'spring', stiffness: 220, damping: 28 });
            animate(dragY, targetY, { type: 'spring', stiffness: 220, damping: 28 });
        } else {
            dragX.set(targetX);
            dragY.set(targetY);
        }
    };

    useEffect(() => {
        if (hasRestoredNavigationRef.current) return;

        const pendingState = pendingRestoreStateRef.current;
        if (!pendingState || gridItems.length === 0 || baseCoords.length === 0) return;

        const restoredIndex = resolveGridRestoreIndex({
            target: pendingState,
            itemCount: gridItems.length,
            findEntryIndex: findEntryIndex,
            matchIndexes,
        });
        const restoredCoord = baseCoords[restoredIndex];
        if (!restoredCoord) return;

        const restoredX = -restoredCoord.baseX;
        const restoredY = -restoredCoord.baseY;

        commitFocusedIndex(restoredIndex);
        dragX.set(restoredX);
        dragY.set(restoredY);
        wheelTargetRef.current = { x: restoredX, y: restoredY };
        updateRenderedIndexesForViewport(restoredX, restoredY, true);

        hasRestoredNavigationRef.current = true;
        pendingRestoreStateRef.current = null;
    }, [baseCoords, findEntryIndex, commitFocusedIndex, dragX, dragY, gridItems.length, matchIndexes, updateRenderedIndexesForViewport]);

    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (gridItems.length === 0 || event.ctrlKey) return;
        if (event.target instanceof Element && event.target.closest('[data-wheel-scroll-region]')) return;

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
        scheduleFocusedIndexCommit(240);
    }, [
        containerSize.height,
        dragX,
        dragY,
        gridItems.length,
        dragBounds,
        scheduleFocusedIndexCommit,
    ]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        element.addEventListener('wheel', handleViewportWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleViewportWheel);
    }, [handleViewportWheel]);

    return {
        dragX,
        dragY,
        dragBounds,
        focusedIndex,
        focusedIndexRef,
        pendingFocusCommitTimeoutRef,
        wheelTargetRef,
        pendingRestoreStateRef,
        hasRestoredNavigationRef,
        baseCoords,
        renderedIndexes,
        renderedIndexesRef,
        updateRenderedIndexesForViewport,
        centerOnIndex,
        commitFocusedIndex,
        scheduleFocusedIndexCommit,
        persistNavigationState,
    };
};
