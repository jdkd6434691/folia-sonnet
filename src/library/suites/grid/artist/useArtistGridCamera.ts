import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, useMotionValue } from 'framer-motion';
import type { LibraryArtistDetail } from '../../../core/artist/artist.contract';
import {
    getLibraryBrowseSession,
    registerLibrarySessionFlush,
    useLibraryBrowseSessionStore,
} from '../../../core/shared/useLibraryBrowseSessionStore';
import { HEX_CARD_CENTER_SCALE } from '../shared/hexCardTransform';
import { squareGridCardBox } from '../shared/gridCardLayout';
import { shouldApplyInitialGridFocus } from '../shared/gridViewRestore';
import { useFoliaHexViewport } from '../shared/useFoliaHexViewport';
import {
    artistGridStateStorageKey,
    buildArtistGridCoords,
    gridItemEntryKey,
    readStoredArtistGridState,
    resolveArtistGridCardBox,
    type ArtistGridRestoreTarget,
    type GridItem,
    type StoredArtistGridNavigationState,
} from './artistGridLayout';

// src/library/suites/grid/artist/useArtistGridCamera.ts
// 歌手页的相机与视口：尺寸、拖拽用的 motion value、可见环带、恢复与持久化、滚轮与每帧的卡片变换。
// 原先这些都以同一顺序写在 ArtistGridView 里，挪出来只为让页面组件回到能读的长度。

type ArtistGridCameraParams = {
    /** 浏览会话的键：布局记录与「看到哪一项」都按它存。 */
    sessionKey: string;
    gridItems: GridItem[];
    topSongCount: number;
    albumCount: number;
    artistInfo: LibraryArtistDetail | null;
    /** 方形卡片档（与 GridView 同一个设置）。 */
    squareCards: boolean;
    minCardScale: number;
    minCardOpacity: number;
};

export const useArtistGridCamera = ({
    sessionKey,
    gridItems,
    topSongCount,
    albumCount,
    artistInfo,
    squareCards,
    minCardScale,
    minCardOpacity,
}: ArtistGridCameraParams) => {
    // Viewport Size Observer
    const containerRef = useRef<HTMLDivElement>(null);
    // The page fills the window, so until the canvas has been measured its size is the window's:
    // the round picture stands at its place from the first render, and that place follows the size.
    const [containerSize, setContainerSize] = useState(() => ({
        width: Math.max(100, window.innerWidth),
        height: Math.max(100, window.innerHeight),
    }));

    const navigationStorageKey = useMemo(() => artistGridStateStorageKey(sessionKey), [sessionKey]);
    // 恢复目标在挂载时定下（歌手页按 collectionKey 挂载）：会话里的语义焦点 + 网格自己的布局记录。
    const [initialRestoreTarget] = useState<ArtistGridRestoreTarget | null>(() => {
        const stored = readStoredArtistGridState(navigationStorageKey);
        const entryKey = getLibraryBrowseSession(sessionKey).focusedEntryKey;
        return stored || entryKey ? { entryKey, stored } : null;
    });
    const pendingRestoreStateRef = useRef<ArtistGridRestoreTarget | null>(initialRestoreTarget);
    const hasRestoredNavigationRef = useRef(false);
    // 初始定位只做一次：专辑列表是分页追加的，只看 items.length 会在数据落地时把相机从用户
    // 已经移过去的那张卡上拽回介绍卡。判据见 shouldApplyInitialGridFocus。
    const hasAppliedInitialFocusRef = useRef(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleResize = (entries: ResizeObserverEntry[]) => {
            const entry = entries[0];
            if (entry) {
                setContainerSize({
                    width: Math.max(100, entry.contentRect.width),
                    height: Math.max(100, entry.contentRect.height),
                });
            }
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Layout values for different container size breakpoints
    const layoutConfig = useMemo(() => {
        const box = resolveArtistGridCardBox(containerSize.width);
        return squareCards ? squareGridCardBox(box) : box;
    }, [containerSize.width, squareCards]);

    // Coordinate motion values mapping grid drags. The camera is where the page's first render
    // needs it: where it was left when an album was opened from the page, else on the biography
    // card's place. Moved there after the cards are drawn, the round picture is seen in one place
    // and then another, and a cover that flies to it is sent to the first.
    const [cameraAtOpen] = useState(() => {
        const left = initialRestoreTarget?.stored;
        if (left && Number.isFinite(left.dragX) && Number.isFinite(left.dragY)) return { x: left.dragX, y: left.dragY };
        const [, biography] = buildArtistGridCoords(0, 0, layoutConfig.spacingX, layoutConfig.spacingY);
        return { x: -biography.baseX, y: -biography.baseY };
    });
    const dragX = useMotionValue(cameraAtOpen.x);
    const dragY = useMotionValue(cameraAtOpen.y);

    // Dynamically calculate visible clipping radius centered on (0,0) viewport coordinates
    const clipRadius = useMemo(() => {
        const { width, height } = containerSize;
        const { cardWidth, cardHeight } = layoutConfig;
        const viewportRadius = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2);
        const cardRadius = Math.sqrt(cardWidth ** 2 + cardHeight ** 2) / 2;
        return viewportRadius + cardRadius + 200; // 200px buffer to prevent visual pop-in during fast drags
    }, [containerSize, layoutConfig]);

    const renderRadius = useMemo(() => (
        clipRadius + Math.max(layoutConfig.spacingX, layoutConfig.spacingY) * 1.5
    ), [clipRadius, layoutConfig.spacingX, layoutConfig.spacingY]);

    const renderRing = useMemo(() => (
        Math.ceil(renderRadius / Math.min(layoutConfig.spacingX, layoutConfig.spacingY)) + 1
    ), [layoutConfig.spacingX, layoutConfig.spacingY, renderRadius]);

    const wheelTargetRef = useRef({ x: cameraAtOpen.x, y: cameraAtOpen.y });
    const focusedIndexRef = useRef(0);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const lastUpdateRef = useRef(0);
    const pendingTimeoutRef = useRef<any>(null);

    // Spacing coordinates matching
    const baseCoords = useMemo(() => {
        return buildArtistGridCoords(topSongCount, albumCount, layoutConfig.spacingX, layoutConfig.spacingY);
    }, [topSongCount, albumCount, layoutConfig.spacingX, layoutConfig.spacingY]);

    const {
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
        coords: baseCoords,
    });

    const dragBounds = useMemo(() => {
        if (baseCoords.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        baseCoords.forEach((coord) => {
            minX = Math.min(minX, coord.baseX);
            maxX = Math.max(maxX, coord.baseX);
            minY = Math.min(minY, coord.baseY);
            maxY = Math.max(maxY, coord.baseY);
        });

        const bufferX = Math.max(0, containerSize.width / 2 - 2 * layoutConfig.spacingX);
        const bufferY = Math.max(0, containerSize.height / 2 - 2 * layoutConfig.spacingY);
        return {
            left: -maxX - bufferX,
            right: -minX + bufferX,
            top: -maxY - bufferY,
            bottom: -minY + bufferY,
        };
    }, [baseCoords, containerSize, layoutConfig.spacingX, layoutConfig.spacingY]);

    // 「看到哪一项」以条目键写进浏览会话（TUI 也认），网格自己的布局另存一份。
    const persistNavigationState = useCallback((index: number) => {
        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        const state: StoredArtistGridNavigationState = {
            focusedIndex: safeIndex,
            dragX: dragX.get(),
            dragY: dragY.get(),
        };
        sessionStorage.setItem(navigationStorageKey, JSON.stringify(state));
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, gridItemEntryKey(gridItems[safeIndex]));
    }, [dragX, dragY, gridItems, navigationStorageKey, sessionKey]);

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

    useEffect(() => {
        if (!shouldApplyInitialGridFocus({
            itemCount: gridItems.length,
            hasAppliedInitialFocus: hasAppliedInitialFocusRef.current,
            restoreApplied: hasRestoredNavigationRef.current,
            restorePending: Boolean(pendingRestoreStateRef.current),
        })) {
            return;
        }
        hasAppliedInitialFocusRef.current = true;
        // Focus on Bio Card (Index 1) initially to give a balanced newspaper view
        centerOnIndex(1, false);
    }, [gridItems.length]);

    useEffect(() => {
        if (hasRestoredNavigationRef.current) return;
        const pending = pendingRestoreStateRef.current;
        // The camera is where it was left from the first render; the card it was left on is looked
        // for once the artist's cards are there.
        if (!pending || !artistInfo || baseCoords.length === 0) return;

        // 会话里的条目键优先（另一个 suite 可能改过它），找不到再用布局记录里的下标。
        const entryIndex = pending.entryKey
            ? gridItems.findIndex(item => gridItemEntryKey(item) === pending.entryKey)
            : -1;
        const storedIndex = pending.stored ? pending.stored.focusedIndex : 1;
        const restoredIndex = Math.max(0, Math.min(entryIndex >= 0 ? entryIndex : storedIndex, gridItems.length - 1));
        // 相机位置只在布局记录指向的就是这张卡时沿用，否则把这张卡居中。
        const stored = pending.stored;
        const keepsStoredCamera = stored !== null && stored.focusedIndex === restoredIndex;
        const restoredX = keepsStoredCamera && Number.isFinite(stored.dragX) ? stored.dragX : -baseCoords[restoredIndex].baseX;
        const restoredY = keepsStoredCamera && Number.isFinite(stored.dragY) ? stored.dragY : -baseCoords[restoredIndex].baseY;

        focusedIndexRef.current = restoredIndex;
        setFocusedIndex(restoredIndex);
        dragX.set(restoredX);
        dragY.set(restoredY);
        wheelTargetRef.current = { x: restoredX, y: restoredY };
        updateRenderedIndexesForViewport(restoredX, restoredY, true);
        hasRestoredNavigationRef.current = true;
        pendingRestoreStateRef.current = null;
    }, [artistInfo, baseCoords, dragX, dragY, gridItems, updateRenderedIndexesForViewport]);

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

    const hasArtist = Boolean(artistInfo);

    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (!hasArtist || event.ctrlKey) return;

        event.preventDefault();
        const deltaScale = (event.deltaMode === 1
            ? 32
            : event.deltaMode === 2
                ? Math.max(containerSize.height, 1)
                : 1) * 2.8;

        const targetX = wheelTargetRef.current.x - event.deltaX * deltaScale;
        const targetY = wheelTargetRef.current.y - event.deltaY * deltaScale;
        const clampedX = Math.max(dragBounds.left, Math.min(dragBounds.right, targetX));
        const clampedY = Math.max(dragBounds.top, Math.min(dragBounds.bottom, targetY));
        wheelTargetRef.current = { x: clampedX, y: clampedY };

        animate(dragX, clampedX, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
        animate(dragY, clampedY, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
    }, [containerSize.height, dragX, dragY, hasArtist, dragBounds]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        element.addEventListener('wheel', handleViewportWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleViewportWheel);
    }, [handleViewportWheel]);

    // direct style manipulation using single centralized rAF loop
    const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        let rafId: number | null = null;

        const updateFocusedIndexThrottled = (newIndex: number) => {
            if (pendingTimeoutRef.current) {
                clearTimeout(pendingTimeoutRef.current);
                pendingTimeoutRef.current = null;
            }

            const now = performance.now();
            const timeSinceLast = now - lastUpdateRef.current;

            if (timeSinceLast >= 200) {
                setFocusedIndex(newIndex);
                focusedIndexRef.current = newIndex;
                lastUpdateRef.current = now;
            } else {
                const remaining = 200 - timeSinceLast;
                pendingTimeoutRef.current = setTimeout(() => {
                    setFocusedIndex(newIndex);
                    focusedIndexRef.current = newIndex;
                    lastUpdateRef.current = performance.now();
                }, remaining);
            }
        };

        const update = () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const dx = dragX.get();
                const dy = dragY.get();
                updateRenderedIndexesForViewport(dx, dy);

                let closestIdx = focusedIndexRef.current;
                let minDistSq = Infinity;
                const activeIndexes = renderedIndexesRef.current;

                for (let activeIndex = 0; activeIndex < activeIndexes.length; activeIndex++) {
                    const i = activeIndexes[activeIndex];
                    const coord = baseCoords[i];
                    if (!coord) continue;
                    const cx = coord.baseX + dx;
                    const cy = coord.baseY + dy;
                    const distSq = cx * cx + cy * cy;

                    if (distSq < minDistSq) {
                        minDistSq = distSq;
                        closestIdx = i;
                    }

                    const el = cardWrapperRefs.current[i];
                    if (!el) continue;

                    const dist = Math.sqrt(distSq);

                    if (dist > clipRadius) {
                        el.style.display = 'none';
                        continue;
                    }

                    el.style.display = '';
                    const tVal = Math.min(dist / layoutConfig.maxDistance, 1);
                    const scale = HEX_CARD_CENTER_SCALE - (HEX_CARD_CENTER_SCALE - minCardScale) * tVal;
                    const opac = 1.0 - (1.0 - minCardOpacity) * tVal;
                    const z = Math.round(50 - 49 * tVal);

                    el.style.transform = `translate(${coord.baseX}px, ${coord.baseY}px) scale(${scale})`;
                    el.style.opacity = String(opac);
                    el.style.zIndex = String(z);

                    if (dist > layoutConfig.lodEnd) {
                        el.style.setProperty('--queue-opacity', '0');
                        el.style.setProperty('--queue-pe', 'none');
                    } else if (dist < layoutConfig.lodStart) {
                        el.style.setProperty('--queue-opacity', '1');
                        el.style.setProperty('--queue-pe', 'auto');
                    } else {
                        const qt = (dist - layoutConfig.lodStart) / (layoutConfig.lodEnd - layoutConfig.lodStart);
                        el.style.setProperty('--queue-opacity', String(1 - qt));
                        el.style.setProperty('--queue-pe', 'auto');
                    }

                    if (dist < 40) {
                        const pt = dist / 40;
                        el.style.setProperty('--play-opacity', String(1 - pt));
                        el.style.setProperty('--play-scale', String(1 - 0.2 * pt));
                        el.style.setProperty('--play-pe', 'auto');
                    } else {
                        el.style.setProperty('--play-opacity', '0');
                        el.style.setProperty('--play-scale', '0.8');
                        el.style.setProperty('--play-pe', 'none');
                    }
                }

                updateFocusedIndexThrottled(closestIdx);
            });
        };

        // The cards of a list that has just changed (the artist's, then each page of albums) are
        // asked for now, not at the next frame.
        updateRenderedIndexesForViewport(dragX.get(), dragY.get());
        update();

        const unsubX = dragX.on('change', update);
        const unsubY = dragY.on('change', update);
        return () => {
            unsubX();
            unsubY();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [dragX, dragY, baseCoords, layoutConfig, clipRadius, minCardOpacity, minCardScale, updateRenderedIndexesForViewport]);

    // 切换 suite 之前，切换器会让当前歌手页把焦点写回会话。写的是已提交的焦点，不是拖拽帧循环里的值。
    const committedFocusIndexRef = useRef(focusedIndex);
    committedFocusIndexRef.current = focusedIndex;
    useEffect(() => registerLibrarySessionFlush(sessionKey, () => persistNavigationState(committedFocusIndexRef.current)), [
        persistNavigationState,
        sessionKey,
    ]);

    return {
        containerRef,
        containerSize,
        layoutConfig,
        dragX,
        dragY,
        clipRadius,
        dragBounds,
        baseCoords,
        renderedIndexes,
        cardWrapperRefs,
        focusedIndex,
        centerOnIndex,
        persistNavigationState,
    };
};
