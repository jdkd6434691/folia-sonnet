import React, { useEffect, useMemo, useRef, type RefObject } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { Disc } from 'lucide-react';
import type { TFunction } from 'i18next';
import { PolaroidCard, type GridItem } from '../shared/PolaroidCard';
import type { GridPlaybackMark } from '../shared/useGridStayPlayback';
import {
    applyHexCardFrameStyles,
    computeHexCardFrame,
    createHexCardFrameStyleCache,
    type HexCardFrameOptions,
    type HexCardFrameStyleCache,
} from '../shared/hexCardTransform';
import type { HexGridCoord } from '../shared/hexViewport';
import { resolveGridRestoreIndex, type GridRestoreTarget } from '../shared/gridViewRestore';
import { GRID_CARD_ITEM_ID_ATTR } from '../transitions/gridMorphContract';
import { playFlyIn } from '../transitions/morphFlyIn';
import { collectionMorphEntranceTravel, collectionMorphFlyIn, collectionMorphSeed } from '../transitions/morphGeometry';
import type { SongResult, Theme, UnifiedSong } from '../../../../types';
import type { CollectionMutationController } from '../../../core/collection/mutations/mutations.contract';

// src/library/suites/grid/collection/useGridViewCards.tsx
// GridView 的卡片层：入场的 hero / 飞入计划、卡片节点、每张卡的 DOM ref，以及那一个集中式 rAF 帧循环。
// 原 GridView.tsx 的 useMemo / useEffect 原样搬出（依赖数组、初始帧与焦点的提交节流都不变）。

export const TRACK_REMOVAL_ANIMATION_MS = 460;
export const TRACK_REMOVAL_BEZIER = [0.22, 0.8, 0.24, 1] as const;

export interface GridViewCardsParams {
    gridItems: readonly GridItem[];
    baseCoords: readonly HexGridCoord[];
    renderedIndexes: number[];
    renderedIndexesRef: RefObject<number[]>;
    dragX: MotionValue<number>;
    dragY: MotionValue<number>;
    cardFrameOptions: HexCardFrameOptions;
    layoutConfig: { cardWidth: number; cardHeight: number; spacingX: number; spacingY: number };
    containerSize: { width: number; height: number };
    focusedIndex: number;
    focusedIndexRef: RefObject<number>;
    pendingFocusCommitTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
    updateRenderedIndexesForViewport: (x: number, y: number, force?: boolean) => void;
    initialRestoreTarget: GridRestoreTarget | null;
    findEntryIndex: (entryKey: string) => number;
    matchIndexes: number[] | null;
    entranceKind: 'morph' | 'cascade' | null;
    shouldAnimateItemEntrance: (key: string) => boolean;
    removingTrackKeys: ReadonlySet<string>;
    isDaylight: boolean;
    theme: Theme;
    mode: 'collection' | 'tracks';
    fullBleedCover: boolean;
    isEditMode: boolean;
    contextActionTracks: SongResult[];
    onSelectTrack?: (track: SongResult, queue: SongResult[]) => void;
    onSelectCollection?: (item: any) => void;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    onAddTrackToQueue?: (track: SongResult) => void;
    trackPlaybackMark?: (track: SongResult | undefined) => GridPlaybackMark | null;
    canMatchSong: boolean;
    mutations: CollectionMutationController | null;
    /** 卡片上的删除按钮（GridView 的 onRemoveTrack）。 */
    onRemoveTrack: (track: SongResult, entryKey: string) => void | Promise<void>;
    persistNavigationState: (index: number) => void;
    centerOnIndex: (index: number, snap?: boolean) => void;
    isDraggingRef: RefObject<boolean>;
    t: TFunction;
}

export const useGridViewCards = ({
    gridItems,
    baseCoords,
    renderedIndexes,
    renderedIndexesRef,
    dragX,
    dragY,
    cardFrameOptions,
    layoutConfig,
    containerSize,
    focusedIndex,
    focusedIndexRef,
    pendingFocusCommitTimeoutRef,
    updateRenderedIndexesForViewport,
    initialRestoreTarget,
    findEntryIndex,
    matchIndexes,
    entranceKind,
    shouldAnimateItemEntrance,
    removingTrackKeys,
    isDaylight,
    theme,
    mode,
    fullBleedCover,
    isEditMode,
    contextActionTracks,
    onSelectTrack,
    onSelectCollection,
    onSelectArtist,
    onSelectAlbum,
    onAddTrackToQueue,
    trackPlaybackMark,
    canMatchSong,
    mutations,
    onRemoveTrack,
    persistNavigationState,
    centerOnIndex,
    isDraggingRef,
    t,
}: GridViewCardsParams) => {
    // Refs for direct DOM manipulation — eliminates per-card useTransform subscriptions
    const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);
    const cardFrameStyleCachesRef = useRef<(HexCardFrameStyleCache | undefined)[]>([]);

    // Memoize only the nearby card set so React keeps heavy image/button trees out of the drag hot path
    // The card the viewport will actually centre on. GridView restores its
    // scroll/focus from sessionStorage in an EFFECT (after first paint), while
    // React's focusedIndex is still 0 when the cards first render — radiating
    // the fly-in from index 0 of a grid that immediately restores elsewhere is
    // what left the cascade skewed. Reading the same session state GridView
    // restores from (through the same resolver the restore effect uses) keeps
    // the origin exact from frame zero; -1 (restored search filter, whose items
    // are not filtered yet) skips the morph entrance and uses the plain one.
    const morphHeroIndex = useMemo(() => {
        if (mode === 'tracks' && initialRestoreTarget) {
            if (initialRestoreTarget.hadQuery) {
                return -1;
            }
            const restored = resolveGridRestoreIndex({
                target: initialRestoreTarget,
                itemCount: gridItems.length,
                findEntryIndex: findEntryIndex,
                matchIndexes,
            });
            if (restored >= 0) {
                return restored;
            }
        }
        return gridItems.length === 0
            ? -1
            : Math.max(0, Math.min(focusedIndex, gridItems.length - 1));
    }, [findEntryIndex, focusedIndex, gridItems.length, initialRestoreTarget, matchIndexes, mode]);

    const cardFlyInOffset = useMemo(() => {
        // The hero is the card the restored viewport actually centres on, NOT
        // index 0: a resumed grid may be scrolled anywhere, and radiating from
        // a stale index-0 slot skews the whole cascade.
        const heroIndex = morphHeroIndex;
        if (!entranceKind || heroIndex < 0 || baseCoords[heroIndex] === undefined) {
            return null;
        }
        const hero = baseCoords[heroIndex];
        // 入场的推进距离是短距离的「就位」，不是从屏幕外飞进来（见 morphGeometry 的说明）。
        const reach = collectionMorphEntranceTravel(containerSize);
        const spacing = Math.max(layoutConfig.spacingX, layoutConfig.spacingY) || 1;
        return { hero, reach, spacing };
    }, [baseCoords, containerSize, layoutConfig.spacingX, layoutConfig.spacingY, morphHeroIndex, entranceKind]);

    const memoizedCards = useMemo(() => {
        return renderedIndexes.map((idx) => {
            const item = gridItems[idx];
            const coord = baseCoords[idx];
            if (!item || !coord) return null;

            const initialDx = dragX.get();
            const initialDy = dragY.get();
            const initialFrame = computeHexCardFrame(coord, initialDx, initialDy, cardFrameOptions);

            const animateEntrance = shouldAnimateItemEntrance(String(item.id));
            const trackKey = String(item.id);
            const isRemovingTrack = removingTrackKeys.has(trackKey);
            // 「移形换影」: the hero (the card the viewport restores onto + centres)
            // stays in its place while `kind === 'morph'` (the stand-in covers it,
            // and hands over to it); every other card that is actually on screen
            // settles into its slot from a short radial push, staggered by distance.
            //
            // 屏外的卡不参与：渲染环本身带 200px 缓冲，那些卡用户根本看不见，却要付一次
            // 动画（大歌单打开时正是这些并发的动画和首帧的挂载一起把主线程压住）。
            const cardOnScreen = initialFrame.display !== 'none' && Number.parseFloat(initialFrame.opacity) > 0.05;
            const isMorphHero = Boolean(entranceKind === 'morph' && cardFlyInOffset && idx === morphHeroIndex);
            const isMorphFlyIn = Boolean(entranceKind && cardFlyInOffset && cardOnScreen && !isMorphHero);
            const morphFlyIn = isMorphFlyIn
                ? collectionMorphFlyIn(
                    { x: coord.baseX, y: coord.baseY },
                    { x: cardFlyInOffset!.hero.baseX, y: cardFlyInOffset!.hero.baseY },
                    cardFlyInOffset!.spacing,
                    cardFlyInOffset!.reach,
                    collectionMorphSeed(String(item.id)),
                )
                : null;
            return (
                <div
                    key={`${mode}-${item.id}`}
                    {...{ [GRID_CARD_ITEM_ID_ATTR]: String(item.id) }}
                    ref={(el) => {
                        if (el) {
                            cardWrapperRefs.current[idx] = el;
                            cardFrameStyleCachesRef.current[idx] = createHexCardFrameStyleCache(initialFrame);
                            return;
                        }

                        if (cardWrapperRefs.current[idx]?.dataset.foliaGridItemId === String(item.id)) {
                            cardWrapperRefs.current[idx] = null;
                            cardFrameStyleCachesRef.current[idx] = undefined;
                        }
                    }}
                    className="absolute select-none pointer-events-auto folia-grid-card-frame"
                    style={{
                        transformOrigin: 'center center',
                        contain: 'layout style',
                        backfaceVisibility: 'hidden',
                        perspective: '1200px',
                        display: initialFrame.display || undefined,
                        transform: initialFrame.transform,
                        opacity: initialFrame.opacity,
                        zIndex: initialFrame.zIndex,
                        '--queue-opacity': initialFrame.queueOpacity,
                        '--queue-pe': initialFrame.queuePointerEvents,
                        '--play-opacity': initialFrame.playOpacity,
                        '--play-scale': initialFrame.playScale,
                        '--play-pe': initialFrame.playPointerEvents,
                    } as React.CSSProperties}
                >
                    <motion.div
                        // The fly-in is the card's own Web Animation, begun in the commit that
                        // mounts it (see morphFlyIn.ts). To framer the card is at rest from the start.
                        ref={morphFlyIn ? card => playFlyIn(card, morphFlyIn) : undefined}
                        initial={isMorphHero
                            // Not shown until the stand-in hands over to it: the handover
                            // holds it and brings it in (standInHandover.ts).
                            ? false
                            : isMorphFlyIn
                                ? false
                                : animateEntrance
                                    ? { opacity: 0, scale: 0.98, rotateY: -90 }
                                    : false}
                        animate={isRemovingTrack
                            ? { opacity: [1, 1, 0], scale: [1, 0.98, 0.96], rotateY: [0, 180, 180] }
                            : {
                                // Key set must be identical across branches: if `rotate`
                                // appears only in the fly-in branch and the plan expires
                                // mid-flight, the key vanishes from animate and the card
                                // freezes at its crooked in-between angle forever.
                                opacity: 1,
                                x: 0,
                                y: 0,
                                scale: 1,
                                rotate: 0,
                                rotateY: 0,
                            }}
                        exit={{
                            opacity: 0,
                            scale: 0.98,
                            rotateY: 90,
                            transition: { duration: 0.36, ease: [0.4, 0, 0.2, 1] },
                        }}
                        transition={isRemovingTrack
                            ? { duration: TRACK_REMOVAL_ANIMATION_MS / 1000, times: [0, 0.72, 1], ease: TRACK_REMOVAL_BEZIER }
                            : entranceKind
                                ? { duration: 0.01 }
                                : { duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                            transformStyle: 'preserve-3d',
                            transformOrigin: 'center center',
                            willChange: 'transform, opacity',
                            pointerEvents: isRemovingTrack ? 'none' : undefined,
                            position: 'relative',
                        }}
                    >
                        <div style={{ backfaceVisibility: 'hidden' }}>
                            <PolaroidCard
                                item={item}
                                isDaylight={isDaylight}
                                theme={theme}
                                mode={mode}
                                t={t}
                                cardWidth={layoutConfig.cardWidth}
                                cardHeight={layoutConfig.cardHeight}
                                fullBleedCover={fullBleedCover}
                                isEditMode={isEditMode}
                                onRemoveTrack={isRemovingTrack ? undefined : () => {
                                    if (item.rawTrack) void onRemoveTrack(item.rawTrack, trackKey);
                                }}
                                onSelectArtist={onSelectArtist}
                                onSelectAlbum={onSelectAlbum}
                                onBeforeNestedNavigate={() => {
                                    persistNavigationState(idx);
                                }}
                                onEditLocalMetadata={(() => {
                                    const track = item.rawTrack;
                                    const songId = (track as UnifiedSong | undefined)?.localRef?.songId;
                                    if (!track || !songId || !canMatchSong) return undefined;
                                    return () => void mutations?.matchSong(track);
                                })()}
                                onSelect={() => {
                                    if (mode === 'tracks' && onSelectTrack && item.rawTrack) {
                                        persistNavigationState(idx);
                                        onSelectTrack(item.rawTrack, contextActionTracks);
                                    } else if (mode === 'collection' && onSelectCollection) {
                                        onSelectCollection(item.rawCollection || item);
                                    }
                                }}
                                onCenter={() => {
                                    if (isDraggingRef.current) return;
                                    centerOnIndex(idx, true);
                                }}
                                onAddQueue={() => {
                                    if (mode === 'tracks' && onAddTrackToQueue && item.rawTrack) {
                                        onAddTrackToQueue(item.rawTrack);
                                    }
                                }}
                                isFocused={idx === focusedIndex}
                                playbackMark={mode === 'tracks' ? trackPlaybackMark?.(item.rawTrack) ?? null : null}
                            />
                        </div>
                        <div
                            aria-hidden="true"
                            className="absolute inset-0 rounded-xl border shadow-lg theme-polaroid-card flex items-center justify-center"
                            style={{
                                backfaceVisibility: 'hidden',
                                transform: 'rotateY(180deg)',
                            }}
                        >
                            <div className="w-[58%] aspect-square rounded-full border border-current flex items-center justify-center opacity-30">
                                <Disc className="w-1/2 h-1/2" />
                            </div>
                        </div>
                    </motion.div>
                </div>
            );
        });
    }, [
        renderedIndexes,
        gridItems,
        baseCoords,
        isDaylight,
        theme,
        mode,
        t,
        layoutConfig.cardWidth,
        layoutConfig.cardHeight,
        cardFrameOptions,
        fullBleedCover,
        isEditMode,
        focusedIndex,
        contextActionTracks,
        onSelectTrack,
        onSelectCollection,
        onSelectArtist,
        onSelectAlbum,
        onAddTrackToQueue,
        trackPlaybackMark,
        canMatchSong,
        mutations,
        onRemoveTrack,
        removingTrackKeys,
        persistNavigationState,
        shouldAnimateItemEntrance,
        cardFlyInOffset,
        morphHeroIndex,
        entranceKind,
    ]);

    // Refs for direct DOM manipulation — eliminates per-card useTransform subscriptions
    // Cleanup deferred focus state commits on unmount
    useEffect(() => {
        return () => {
            if (pendingFocusCommitTimeoutRef.current) {
                clearTimeout(pendingFocusCommitTimeoutRef.current);
            }
        };
    }, []);

    /**
     * Single centralized rAF loop: subscribes to dragX/dragY ONCE and only
     * updates the mounted viewport-near card set resolved from the hex grid.
     */
    useEffect(() => {
        let rafId: number | null = null;

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
                    const frame = computeHexCardFrame(coord, dx, dy, cardFrameOptions);

                    // Track closest card for focusedIndex
                    if (frame.distanceSq < minDistSq) {
                        minDistSq = frame.distanceSq;
                        closestIdx = i;
                    }

                    const el = cardWrapperRefs.current[i];
                    if (!el) continue;
                    const cache = cardFrameStyleCachesRef.current[i] ?? {};
                    cardFrameStyleCachesRef.current[i] = cache;
                    applyHexCardFrameStyles(el, frame, cache);
                }

                // Keep continuous focus out of React state during drag frames.
                focusedIndexRef.current = closestIdx;
            });
        };

        // Run once immediately to position all cards
        update();

        const unsubX = dragX.on('change', update);
        const unsubY = dragY.on('change', update);
        return () => {
            unsubX();
            unsubY();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [dragX, dragY, baseCoords, cardFrameOptions, updateRenderedIndexesForViewport]);


    return { cards: memoizedCards, cardWrapperRefs, morphHeroIndex };
};
