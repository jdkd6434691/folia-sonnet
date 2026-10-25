import React, { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import { isHideableDirectoryItem } from '../../../core/directory/directoryVisibility';
import { MapCard } from './GridMapCard';
import type { GridMapBatchConfig, GridMapItem } from './GridMap';

// src/library/suites/grid/directory/GridMap.tsx 的卡片层：卡片节点、卡片的 DOM 引用，以及那一个 rAF 帧循环。
// 原样搬出：初始 scale / opacity / zIndex、200ms 的焦点提交节流、按距离的显隐都在这里，GridMap 只拿卡片与引用。

export interface GridMapCardsParams {
    displayItems: GridMapItem[];
    renderedIndexes: number[];
    renderedIndexesRef: React.RefObject<number[]>;
    baseCoords: readonly { baseX: number; baseY: number; distanceSq?: number }[];
    dragX: MotionValue<number>;
    dragY: MotionValue<number>;
    layoutConfig: { cardWidth: number; cardHeight: number; maxDistance: number };
    clipRadius: number;
    focusedIndexRef: React.RefObject<number>;
    setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
    pendingTimeoutRef: React.RefObject<NodeJS.Timeout | null>;
    lastUpdateRef: React.RefObject<number>;
    updateRenderedIndexesForViewport: (x: number, y: number, force?: boolean) => void;
    isDaylight: boolean;
    isPlaylistEditMode: boolean;
    hiddenIds: ReadonlySet<string>;
    batchConfig?: GridMapBatchConfig;
    showCutInPanel: boolean;
    selectedBatchItemIds: ReadonlySet<string>;
    toggleBatchItemSelected: (itemId: string) => void;
    onTogglePlaylistHidden?: (item: GridMapItem) => void;
    selectDisplayedItem: (item: GridMapItem, displayIndex: number) => void;
    suppressSelectionRef: React.RefObject<boolean>;
}

export const useGridMapCards = ({
    displayItems,
    renderedIndexes,
    renderedIndexesRef,
    baseCoords,
    dragX,
    dragY,
    layoutConfig,
    clipRadius,
    focusedIndexRef,
    setFocusedIndex,
    pendingTimeoutRef,
    lastUpdateRef,
    updateRenderedIndexesForViewport,
    isDaylight,
    isPlaylistEditMode,
    hiddenIds,
    batchConfig,
    showCutInPanel,
    selectedBatchItemIds,
    toggleBatchItemSelected,
    onTogglePlaylistHidden,
    selectDisplayedItem,
    suppressSelectionRef,
}: GridMapCardsParams) => {
    const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);

    const memoizedCards = useMemo(() => {
        return renderedIndexes.map((idx) => {
            const item = displayItems[idx];
            const coord = baseCoords[idx];
            if (!item || !coord) return null;

            const initialDx = dragX.get();
            const initialDy = dragY.get();
            const initialCenterX = coord.baseX + initialDx;
            const initialCenterY = coord.baseY + initialDy;
            const initialDist = Math.sqrt(initialCenterX * initialCenterX + initialCenterY * initialCenterY);
            const initialT = Math.min(initialDist / layoutConfig.maxDistance, 1);
            const initialScale = 1.1 - 0.65 * initialT;
            const initialOpacity = 1.0 - 0.72 * initialT;
            const initialZ = Math.round(50 - 49 * initialT);

            return (
                <div
                    key={`map-${idx}-${item.id}`}
                    ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                    className="absolute select-none pointer-events-auto"
                    style={{
                        transformOrigin: 'center center',
                        willChange: 'transform, opacity',
                        display: initialDist > clipRadius ? 'none' : undefined,
                        transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                        opacity: initialDist > clipRadius ? 0 : initialOpacity,
                        zIndex: initialZ,
                    }}
                >
                    <MapCard
                        item={item}
                        isDaylight={isDaylight}
                        isPlaylistEditMode={isPlaylistEditMode}
                        isHidden={hiddenIds.has(String(item.id))}
                        isBatchMode={Boolean(batchConfig && showCutInPanel)}
                        isBatchSelected={selectedBatchItemIds.has(String(item.id))}
                        onTogglePlaylistHidden={isHideableDirectoryItem(item) && onTogglePlaylistHidden
                            ? () => onTogglePlaylistHidden(item)
                            : undefined}
                        cardWidth={layoutConfig.cardWidth}
                        cardHeight={layoutConfig.cardHeight}
                        onSelect={() => {
                            // A drag may still emit a click on the card; suppress it before any batch toggle.
                            if (suppressSelectionRef.current) return;
                            if (batchConfig && showCutInPanel) {
                                toggleBatchItemSelected(String(item.id));
                                return;
                            }
                            if (isPlaylistEditMode && isHideableDirectoryItem(item)) return;
                            selectDisplayedItem(item, idx);
                        }}
                    />
                </div>
            );
        });
    }, [
        renderedIndexes,
        displayItems,
        baseCoords,
        isDaylight,
        isPlaylistEditMode,
        hiddenIds,
        batchConfig,
        showCutInPanel,
        selectedBatchItemIds,
        toggleBatchItemSelected,
        onTogglePlaylistHidden,
        layoutConfig.cardWidth,
        layoutConfig.cardHeight,
        layoutConfig.maxDistance,
        clipRadius,
        selectDisplayedItem,
    ]);

    useEffect(() => {
        return () => {
            if (pendingTimeoutRef.current) {
                clearTimeout(pendingTimeoutRef.current);
            }
        };
    }, []);
    /**
     * Centralized animation frame callback that coordinates translation,
     * scaling, opacity, and layering of all honeycomb grid cards dynamically.
     */
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
                const { maxDistance } = layoutConfig;
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
                    const t = Math.min(dist / maxDistance, 1);
                    const scale = 1.1 - 0.65 * t;
                    const opac = 1.0 - 0.72 * t;
                    const z = Math.round(50 - 49 * t);

                    el.style.transform = `translate(${coord.baseX}px, ${coord.baseY}px) scale(${scale})`;
                    el.style.opacity = String(opac);
                    el.style.zIndex = String(z);
                }

                updateFocusedIndexThrottled(closestIdx);
            });
        };

        update();

        const unsubX = dragX.on('change', update);
        const unsubY = dragY.on('change', update);
        return () => {
            unsubX();
            unsubY();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [dragX, dragY, baseCoords, layoutConfig, clipRadius, updateRenderedIndexesForViewport]);

    return { cards: memoizedCards, cardWrapperRefs };
};
