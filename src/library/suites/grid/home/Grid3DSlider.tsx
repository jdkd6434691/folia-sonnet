import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeLayoutSettingsStore } from '../../../../stores/useHomeLayoutSettingsStore';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { useCompactUiScale } from '../../../../hooks/useCompactUiScale';
import { hasBlockingWindow } from '../../../../utils/keyboardTargets';
import { Grid3DSliderCard } from './Grid3DSliderCard';
import {
    DISCRETE_WHEEL_DISTANCE_MULTIPLIER,
    GRID3D_CARD_GAP,
    GRID3D_COMPACT_CAPTION_PX,
    GRID3D_COMPACT_CARD_RATIO,
    GRID3D_COMPACT_MIN_COVER_PX,
    GRID3D_COMPACT_PEAK_SCALE,
    GRID3D_COMPACT_SCROLLER_PAD_PX,
    PROGRAMMATIC_SCROLL_IDLE_TIMEOUT_MS,
    PROGRAMMATIC_SCROLL_SETTLE_PX,
    PROGRAMMATIC_SCROLL_TIMEOUT_MS,
    WHEEL_SMOOTHING_MAX_DURATION_MS,
    WHEEL_SMOOTHING_MIN_PROGRESS,
    WHEEL_SMOOTHING_SETTLE_DISTANCE,
    clampFocusedIndex,
    getGrid3DItemsSignature,
    getGrid3DSliderDisplayName,
    getGrid3DSliderSecondaryText,
    getGrid3DTargetScrollLeft,
    getGrid3DWindowRange,
    resolveGrid3DLeapPlan,
    resolveGrid3DTransitionMode,
    resolveGrid3DWheelInput,
    type Grid3DSliderProps,
} from './grid3DSliderModel';

// src/library/suites/grid/home/Grid3DSlider.tsx
// Controlled desktop Grid3D slider shared by Netease, local music, and Navidrome overview surfaces.
//
// 纯函数与显示文案在 grid3DSliderModel，卡片在 Grid3DSliderCard；这里只剩滚动、焦点与底部字幕。
// 对外导出保持原路径：DesktopGrid3DSurface 与 test/unit/gridView/grid3DSlider.test 都从这里引。
export * from './grid3DSliderModel';

export const Grid3DSlider: React.FC<Grid3DSliderProps> = ({
    items,
    focusedIndex,
    onFocusedIndexChange,
    onSelect,
    isInteractive = true,
    isLoading = false,
    emptyMessage,
    isDaylight,
    hasFloatingPlayer = false,
}) => {
    const { t } = useTranslation();
    const grid3dCardStyle = useHomeLayoutSettingsStore(state => state.grid3dCardStyle);
    const reduceMicroMotion = useReducedMotionFor('uiMicroMotion');

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const onFocusedIndexChangeRef = useRef(onFocusedIndexChange);
    const focusedIndexRef = useRef(focusedIndex);
    const lastInternalFocusRef = useRef<number | null>(null);
    const prevItemsSignatureRef = useRef<string | null>(null);
    const prevFocusedIndexRef = useRef(focusedIndex);
    const isProgrammaticScrollRef = useRef(false);
    const programmaticTargetLeftRef = useRef<number | null>(null);
    const programmaticScrollTimeoutRef = useRef<any>(null);
    const lastKeyboardNavTimeRef = useRef(0);
    const wheelIdleTimerRef = useRef<any>(null);
    const momentumVelocityRef = useRef(0);
    const momentumRafRef = useRef<number | null>(null);
    const wheelSmoothingRafRef = useRef<number | null>(null);
    const wheelSmoothingTargetRef = useRef<number | null>(null);
    const wheelSmoothingLastTimeRef = useRef(0);
    const wheelSmoothingStartedAtRef = useRef(0);
    const isDraggingRef = useRef(false);
    const startXRef = useRef(0);
    const scrollLeftRef = useRef(0);
    const dragDistanceRef = useRef(0);
    const lastDragScrollRef = useRef(0);
    const lastDragTimeRef = useRef(0);

    const [containerSize, setContainerSize] = useState(() => {
        if (typeof window === 'undefined') {
            return { width: 0, height: 0 };
        }
        return { width: window.innerWidth, height: window.innerHeight };
    });

    focusedIndexRef.current = focusedIndex;

    useEffect(() => {
        onFocusedIndexChangeRef.current = onFocusedIndexChange;
    }, [onFocusedIndexChange]);

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

        const observer = new ResizeObserver(updateContainerSize);
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    const isDesktopWidth = containerSize.width >= 768;
    const isNarrowLayout = containerSize.width > 0 && containerSize.width < 768;
    const isShortLayout = containerSize.height > 0 && containerSize.height < (hasFloatingPlayer ? 420 : 380);
    const useCompactMetrics = isNarrowLayout || isShortLayout;
    const isCompactUi = useCompactUiScale();
    const isLargeDesktop = !useCompactMetrics
        && isDesktopWidth
        && containerSize.width >= 1440
        && containerSize.height >= (hasFloatingPlayer ? 660 : 600);
    const isUltraDesktop = !useCompactMetrics
        && isDesktopWidth
        && containerSize.width >= 2000
        && containerSize.height >= (hasFloatingPlayer ? 780 : 720);

    // 放大倍数提到这里：卡片尺寸要按它反算（见下），两边必须是同一个值。
    // 紧凑档降一档 —— 那档的内边距只有 20px，兜不住桌面档那么大的放大溢出。
    const peakScale = isCompactUi
        ? GRID3D_COMPACT_PEAK_SCALE
        : (grid3dCardStyle === 'image' ? 1.25 : 1.2);
    const compactCoverCeiling = isDesktopWidth ? 208 : 192;

    /*
     * 手机横屏（紧凑档）下纵向空间是唯一的硬约束：滚动容器按内容撑高、再把超出的部分裁掉，
     * 所以卡片一高就被上下各切一刀 —— 滑到中间放大时切得最狠，最底那截还会伸到悬浮播放条上
     * （播放按钮就在那儿）。
     *
     * 与其靠裁剪兜底，不如按容器高度反推封面尺寸：容器高 − 滚动容器的上下内边距 − 底部标题块，
     * 再除以放大倍数，就是「放大之后刚好整个装得下」的宽度。相纸卡在这一档退化成方形
     * （素材区的三行文字被隐藏，见 androidPhoneFit.css），所以两种样式的比例都是 1。
     *
     * 只在紧凑档生效：竖屏手机、桌面、平板走的还是原来那套按宽度的档位表。
     * 量不到容器高度时（首帧）退回那一档的上限，下一帧就会纠正。
     */
    const compactFitCover = containerSize.height > 0
        ? Math.floor(
            (containerSize.height - GRID3D_COMPACT_SCROLLER_PAD_PX * 2 - GRID3D_COMPACT_CAPTION_PX)
            / GRID3D_COMPACT_CARD_RATIO / peakScale,
        )
        : compactCoverCeiling;

    const coverSize = isCompactUi
        ? Math.max(GRID3D_COMPACT_MIN_COVER_PX, Math.min(compactCoverCeiling, compactFitCover))
        : useCompactMetrics
            ? (isDesktopWidth ? 208 : 192)
            : (isDesktopWidth ? (isUltraDesktop ? 360 : isLargeDesktop ? 312 : 218) : 224);
    const edgePadding = Math.max(0, (containerSize.width - coverSize) / 2);

    const safeFocusedIndex = clampFocusedIndex(focusedIndex, items.length);
    const itemsSignature = useMemo(() => getGrid3DItemsSignature(items), [items]);

    const loadedIndices = useMemo(() => {
        const indexes = new Set<number>();
        const start = Math.max(0, safeFocusedIndex - 12);
        const end = Math.min(items.length - 1, safeFocusedIndex + 12);
        for (let index = start; index <= end; index += 1) indexes.add(index);
        return indexes;
    }, [items.length, safeFocusedIndex]);

    const { start: windowStart, end: windowEnd } = getGrid3DWindowRange(safeFocusedIndex, items.length);
    const windowedItems = items.slice(windowStart, windowEnd);
    const cardPitch = coverSize + GRID3D_CARD_GAP;
    const leadingSpacerWidth = windowStart * cardPitch;
    const remainingItemCount = items.length - windowEnd;
    const trailingSpacerWidth = remainingItemCount > 0
        ? remainingItemCount * coverSize + Math.max(0, remainingItemCount - 1) * GRID3D_CARD_GAP
        : 0;

    const updateCardTransforms = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return undefined;
        const maxDist = 600;
        const minScale = 0.5;
        const cards = container.querySelectorAll<HTMLElement>('[data-grid3d-index]');
        const viewportWidth = container.clientWidth;
        const containerCenter = container.scrollLeft + viewportWidth / 2;
        const closestIndex = clampFocusedIndex(
            Math.round((containerCenter - edgePadding - coverSize / 2) / cardPitch),
            items.length,
        );
        for (let i = 0; i < cards.length; i++) {
            const el = cards[i];
            const itemIndex = Number(el.dataset.grid3dIndex);
            const cardCenter = edgePadding + itemIndex * cardPitch + coverSize / 2;
            const pixelDist = Math.abs(cardCenter - containerCenter);
            const tValue = Math.min(pixelDist / maxDist, 1);

            const scale = peakScale - (peakScale - minScale) * tValue;
            const opacity = Math.max(0.15, 1.0 - 0.85 * tValue);
            const y = -6 * (1 - tValue);
            const z = Math.max(1, Math.round(10 - 9 * tValue));

            el.style.transform = `scale(${scale}) translateY(${y}px)`;
            el.style.opacity = String(opacity);
            el.style.zIndex = String(z);
        }

        return closestIndex;
    }, [cardPitch, coverSize, edgePadding, items.length, peakScale]);

    const reportFocusedIndex = useCallback((index: number) => {
        const nextIndex = clampFocusedIndex(index, items.length);
        if (nextIndex === focusedIndexRef.current) {
            return;
        }

        lastInternalFocusRef.current = nextIndex;
        onFocusedIndexChangeRef.current(nextIndex);
    }, [items.length]);

    const stopMomentum = useCallback(() => {
        if (momentumRafRef.current !== null) {
            cancelAnimationFrame(momentumRafRef.current);
            momentumRafRef.current = null;
        }
        momentumVelocityRef.current = 0;
    }, []);

    const stopWheelSmoothing = useCallback(() => {
        if (wheelSmoothingRafRef.current !== null) {
            cancelAnimationFrame(wheelSmoothingRafRef.current);
            wheelSmoothingRafRef.current = null;
        }
        wheelSmoothingTargetRef.current = null;
        wheelSmoothingLastTimeRef.current = 0;
        wheelSmoothingStartedAtRef.current = 0;
    }, []);

    // Coalesces low-frequency mouse-wheel notches into one compositor-friendly scroll update per frame.
    const smoothDiscreteWheelBy = useCallback((delta: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
        const currentTarget = wheelSmoothingTargetRef.current ?? container.scrollLeft;
        wheelSmoothingTargetRef.current = Math.max(
            0,
            Math.min(maxScrollLeft, currentTarget + delta * DISCRETE_WHEEL_DISTANCE_MULTIPLIER),
        );
        wheelSmoothingStartedAtRef.current = performance.now();

        if (wheelSmoothingRafRef.current !== null) return;

        const tick = (now: number) => {
            const activeContainer = scrollContainerRef.current;
            const target = wheelSmoothingTargetRef.current;
            if (!activeContainer || target === null) {
                stopWheelSmoothing();
                return;
            }

            const elapsed = wheelSmoothingLastTimeRef.current === 0
                ? 16.67
                : Math.min(now - wheelSmoothingLastTimeRef.current, 32);
            wheelSmoothingLastTimeRef.current = now;
            const progress = 1 - Math.pow(0.78, elapsed / 16.67);
            const liveMaxScrollLeft = Math.max(
                0,
                activeContainer.scrollWidth - activeContainer.clientWidth,
            );
            const boundedTarget = Math.max(0, Math.min(liveMaxScrollLeft, target));
            wheelSmoothingTargetRef.current = boundedTarget;
            const beforeScrollLeft = activeContainer.scrollLeft;
            const remaining = boundedTarget - beforeScrollLeft;
            const totalElapsed = wheelSmoothingStartedAtRef.current > 0
                ? now - wheelSmoothingStartedAtRef.current
                : 0;

            if (
                Math.abs(remaining) <= WHEEL_SMOOTHING_SETTLE_DISTANCE
                || totalElapsed >= WHEEL_SMOOTHING_MAX_DURATION_MS
            ) {
                activeContainer.scrollLeft = boundedTarget;
                stopWheelSmoothing();
                return;
            }

            activeContainer.scrollLeft += remaining * progress;
            const actualProgress = Math.abs(activeContainer.scrollLeft - beforeScrollLeft);
            if (actualProgress < WHEEL_SMOOTHING_MIN_PROGRESS) {
                activeContainer.scrollLeft = boundedTarget;
                stopWheelSmoothing();
                return;
            }

            wheelSmoothingRafRef.current = requestAnimationFrame(tick);
        };

        wheelSmoothingRafRef.current = requestAnimationFrame(tick);
    }, [stopWheelSmoothing]);

    const startMomentum = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container || Math.abs(momentumVelocityRef.current) < 0.5) return;

        let lastTime = performance.now();
        const friction = 0.80;

        const tick = (now: number) => {
            const elapsed = now - lastTime;
            lastTime = now;
            const frames = elapsed / 16.67;
            momentumVelocityRef.current *= Math.pow(friction, frames);

            if (Math.abs(momentumVelocityRef.current) < 0.5) {
                momentumVelocityRef.current = 0;
                momentumRafRef.current = null;
                return;
            }

            container.scrollLeft += momentumVelocityRef.current;
            momentumRafRef.current = requestAnimationFrame(tick);
        };

        momentumRafRef.current = requestAnimationFrame(tick);
    }, []);

    const clearProgrammaticScrollState = useCallback(() => {
        isProgrammaticScrollRef.current = false;
        programmaticTargetLeftRef.current = null;
        if (programmaticScrollTimeoutRef.current) {
            clearTimeout(programmaticScrollTimeoutRef.current);
            programmaticScrollTimeoutRef.current = null;
        }
    }, []);

    const armProgrammaticScrollTimeout = useCallback((timeoutMs: number) => {
        if (programmaticScrollTimeoutRef.current) {
            clearTimeout(programmaticScrollTimeoutRef.current);
        }
        programmaticScrollTimeoutRef.current = setTimeout(() => {
            clearProgrammaticScrollState();
        }, timeoutMs);
    }, [clearProgrammaticScrollState]);

    const stopKineticScroll = useCallback(() => {
        if (wheelIdleTimerRef.current) {
            clearTimeout(wheelIdleTimerRef.current);
            wheelIdleTimerRef.current = null;
        }
        stopWheelSmoothing();
        stopMomentum();
    }, [stopMomentum, stopWheelSmoothing]);

    const centerIndex = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
        if (index < 0 || index >= items.length) return;
        const container = scrollContainerRef.current;
        if (!container) return;

        const targetScrollLeft = getGrid3DTargetScrollLeft(
            index,
            container.clientWidth,
            container.scrollWidth,
            cardPitch,
            coverSize,
            edgePadding,
        );

        isProgrammaticScrollRef.current = true;
        programmaticTargetLeftRef.current = targetScrollLeft;
        armProgrammaticScrollTimeout(PROGRAMMATIC_SCROLL_TIMEOUT_MS);

        container.scrollTo({
            left: targetScrollLeft,
            behavior,
        });
    }, [armProgrammaticScrollTimeout, cardPitch, coverSize, edgePadding, items.length]);

    const scrollToIndex = useCallback((index: number) => {
        if (!isInteractive) return;
        stopKineticScroll();
        reportFocusedIndex(index);
        centerIndex(index, 'smooth');
    }, [centerIndex, isInteractive, reportFocusedIndex, stopKineticScroll]);

    useEffect(() => {
        if (isLoading || items.length === 0) return;
        const nextIndex = clampFocusedIndex(focusedIndex, items.length);

        if (nextIndex !== focusedIndex) {
            onFocusedIndexChangeRef.current(nextIndex);
            return;
        }

        const isListChanged = prevItemsSignatureRef.current !== itemsSignature;
        const prevIndex = prevFocusedIndexRef.current;

        prevItemsSignatureRef.current = itemsSignature;
        prevFocusedIndexRef.current = nextIndex;

        if (lastInternalFocusRef.current === nextIndex) {
            lastInternalFocusRef.current = null;
            const frameId = requestAnimationFrame(() => updateCardTransforms());
            return () => cancelAnimationFrame(frameId);
        }

        const transitionMode = resolveGrid3DTransitionMode({
            isListChanged,
            prevIndex,
            nextIndex,
            reduceMicroMotion,
        });

        const frameId = requestAnimationFrame(() => {
            if (transitionMode === 'leap') {
                const { stagingIndex } = resolveGrid3DLeapPlan({
                    prevIndex,
                    nextIndex,
                    itemCount: items.length,
                });
                centerIndex(stagingIndex, 'auto');
                updateCardTransforms();
                centerIndex(nextIndex, 'smooth');
            } else {
                centerIndex(nextIndex, transitionMode === 'direct' ? 'smooth' : 'auto');
                updateCardTransforms();
            }
        });
        return () => cancelAnimationFrame(frameId);
    }, [centerIndex, focusedIndex, isLoading, items.length, itemsSignature, reduceMicroMotion, updateCardTransforms]);

    const handleScroll = useCallback(() => {
        if (!isInteractive) {
            updateCardTransforms();
            return;
        }

        const container = scrollContainerRef.current;
        if (!container) return;

        const closestIndex = updateCardTransforms();

        if (isProgrammaticScrollRef.current) {
            if (programmaticTargetLeftRef.current !== null) {
                const diff = Math.abs(container.scrollLeft - programmaticTargetLeftRef.current);
                if (diff < PROGRAMMATIC_SCROLL_SETTLE_PX) {
                    clearProgrammaticScrollState();
                } else {
                    // 原生平滑滚动仍在活跃推进中：通过空闲看门狗续期抑制窗口，防止远距离平滑滚动超过初始超时而提前上报中间焦点。
                    // 只要浏览器仍在触发 scroll 事件朝目标推进就持续抑制；若滚动停止或卡死，将在空闲超时后兜底恢复。
                    armProgrammaticScrollTimeout(PROGRAMMATIC_SCROLL_IDLE_TIMEOUT_MS);
                }
            } else {
                clearProgrammaticScrollState();
            }
            return;
        }

        if (closestIndex !== undefined) {
            reportFocusedIndex(closestIndex);
        }

    }, [armProgrammaticScrollTimeout, clearProgrammaticScrollState, isInteractive, reportFocusedIndex, updateCardTransforms]);

    const handleMouseDown = (event: React.MouseEvent) => {
        if (!isInteractive || !scrollContainerRef.current || event.button !== 0) return;

        // 用户主动拖拽接管滚动，解除程序化滚动的抑制并恢复焦点实时上报，避免拖拽打断期间焦点被卡住。
        clearProgrammaticScrollState();
        stopKineticScroll();
        isDraggingRef.current = true;
        startXRef.current = event.pageX - scrollContainerRef.current.offsetLeft;
        scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
        dragDistanceRef.current = 0;
        lastDragScrollRef.current = scrollContainerRef.current.scrollLeft;
        lastDragTimeRef.current = performance.now();
    };

    const handleMouseMove = (event: React.MouseEvent) => {
        if (!isInteractive || !isDraggingRef.current || !scrollContainerRef.current) return;

        event.preventDefault();
        const x = event.pageX - scrollContainerRef.current.offsetLeft;
        const walk = (x - startXRef.current) * 1.5;
        dragDistanceRef.current = Math.abs(walk);

        scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
        const nowScroll = scrollContainerRef.current.scrollLeft;

        const now = performance.now();
        const dt = now - lastDragTimeRef.current;
        if (dt > 0) {
            momentumVelocityRef.current = (nowScroll - lastDragScrollRef.current) / dt * 16;
        }
        lastDragScrollRef.current = nowScroll;
        lastDragTimeRef.current = now;
    };

    const handleMouseUpOrLeave = () => {
        if (!isInteractive || !isDraggingRef.current) return;
        isDraggingRef.current = false;
        startMomentum();
    };

    useEffect(() => {
        if (!isInteractive) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            // A window or a dialog over the page has the keyboard.
            if (hasBlockingWindow()) return;
            const target = event.target;
            if (
                target instanceof HTMLElement
                && (target.isContentEditable || Boolean(target.closest('button, input, select, textarea, a[href]')))
            ) {
                return;
            }

            if (event.key === 'Enter') {
                if (event.repeat || items.length === 0) return;
                event.preventDefault();
                const focusedItem = items[safeFocusedIndex];
                if (focusedItem) onSelect(focusedItem, safeFocusedIndex);
                return;
            }

            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return;
            }

            event.preventDefault();
            const now = performance.now();
            if (now - lastKeyboardNavTimeRef.current < 200) return;
            lastKeyboardNavTimeRef.current = now;
            scrollToIndex(event.key === 'ArrowLeft' ? safeFocusedIndex - 1 : safeFocusedIndex + 1);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isInteractive, items, onSelect, safeFocusedIndex, scrollToIndex]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || !isInteractive) return;

        const handleWheelEvent = (event: WheelEvent) => {
            event.preventDefault();

            // 用户滚轮主动接管滚动，解除程序化抑制并打断惯性滚动。
            clearProgrammaticScrollState();
            stopMomentum();
            const wheelInput = resolveGrid3DWheelInput(
                event.deltaX,
                event.deltaY,
                event.deltaMode,
                container.clientWidth,
            );

            if (wheelInput.isDiscreteMouseWheel) {
                if (wheelIdleTimerRef.current) {
                    clearTimeout(wheelIdleTimerRef.current);
                    wheelIdleTimerRef.current = null;
                }
                smoothDiscreteWheelBy(wheelInput.delta);
                return;
            }

            stopWheelSmoothing();
            const scaled = wheelInput.delta * 0.6;
            container.scrollLeft += scaled;
            momentumVelocityRef.current = scaled;

            if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current);
            wheelIdleTimerRef.current = setTimeout(() => {
                startMomentum();
            }, 80);
        };

        container.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheelEvent);
            if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current);
        };
    }, [clearProgrammaticScrollState, isInteractive, smoothDiscreteWheelBy, startMomentum, stopMomentum, stopWheelSmoothing]);

    // Repaints the fixed card window after layout or focus changes.
    useEffect(() => {
        const frameId = requestAnimationFrame(() => updateCardTransforms());
        return () => cancelAnimationFrame(frameId);
    }, [containerSize, coverSize, edgePadding, isLoading, itemsSignature, windowStart, windowedItems.length, updateCardTransforms]);

    useEffect(() => {
        return () => {
            clearProgrammaticScrollState();
            stopKineticScroll();
        };
    }, [clearProgrammaticScrollState, stopKineticScroll]);

    const focusedItem = items[safeFocusedIndex];
    const focusedDisplayName = focusedItem ? getGrid3DSliderDisplayName(focusedItem) : '';
    const focusedSecondaryText = focusedItem ? getGrid3DSliderSecondaryText(focusedItem) : '';

    return (
        <div ref={containerRef} data-grid3d-slider-root className="w-full flex-1 flex flex-col justify-center relative min-h-0 select-none">
            <div
                ref={scrollContainerRef}
                data-grid3d-slider
                tabIndex={-1}
                onScroll={handleScroll}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave}
                onMouseLeave={handleMouseUpOrLeave}
                className={`w-full flex items-center overflow-x-auto overflow-y-hidden py-24 hide-scrollbar focus:outline-none ${
                    isInteractive ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                }`}
            >
                <div className="flex" style={{ paddingInline: edgePadding }}>
                    {isLoading ? (
                        Array.from({ length: 5 }).map((_, index) => (
                            <div key={`skeleton-${index}`} className="shrink-0 pointer-events-none select-none">
                                {grid3dCardStyle === 'image' ? (
                                    <div
                                        data-grid3d-card="image"
                                        className="aspect-square rounded-2xl animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 border border-white/5 shadow-inner"
                                        style={{ width: coverSize, height: coverSize }}
                                    />
                                ) : (
                                    <div
                                        data-grid3d-card="polaroid"
                                        className="rounded-xl border border-white/5 p-4 flex flex-col items-center backdrop-blur-md shadow-lg"
                                        style={{ width: coverSize }}
                                    >
                                        <div data-grid3d-card-cover className="w-full aspect-square rounded-lg animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 mb-4" />
                                        <div data-grid3d-card-text className="w-full text-left pt-2 space-y-2">
                                            <div className="h-4 w-3/4 animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 rounded-md" />
                                            <div className="h-3 w-1/2 animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 rounded-md" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    ) : items.length === 0 ? (
                        <div className="opacity-40 text-sm font-sans flex items-center justify-center w-[20vw] shrink-0 text-center">
                            {emptyMessage || t('ui.noItemsFound')}
                        </div>
                    ) : (
                        <>
                        {leadingSpacerWidth > 0 && (
                            <div aria-hidden="true" className="shrink-0" style={{ width: leadingSpacerWidth }} />
                        )}
                        {windowedItems.map((item, localIndex) => {
                            const index = windowStart + localIndex;
                            const isFocused = index === safeFocusedIndex;

                            return (
                                <Grid3DSliderCard
                                    key={item.id}
                                    item={item}
                                    index={index}
                                    isFocused={isFocused}
                                    coverSize={coverSize}
                                    cardStyle={grid3dCardStyle}
                                    hasCover={loadedIndices.has(index)}
                                    marginRight={index < items.length - 1 ? GRID3D_CARD_GAP : 0}
                                    onClick={() => {
                                        if (!isInteractive || dragDistanceRef.current >= 8) return;
                                        if (isFocused) {
                                            onSelect(item, index);
                                        } else {
                                            scrollToIndex(index);
                                        }
                                    }}
                                />
                            );
                        })}
                        {trailingSpacerWidth > 0 && (
                            <div aria-hidden="true" className="shrink-0" style={{ width: trailingSpacerWidth }} />
                        )}
                        </>
                    )}
                </div>
            </div>

            {!isLoading && focusedItem && (
                <div
                    data-grid3d-caption
                    className={`relative shrink-0 text-center z-10 px-8 pointer-events-none ${
                        hasFloatingPlayer ? 'pt-6 md:pt-8 pb-0 -mb-4 md:-mb-6' : 'pt-5 md:pt-6 pb-4'
                    }`}
                >
                    <h3 className="font-bold text-2xl truncate max-w-xl mx-auto" style={{ color: 'var(--text-primary)' }}>
                        {focusedDisplayName}
                    </h3>
                    <p className="text-xs opacity-50 font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {focusedItem.trackCount !== undefined ? `${focusedItem.trackCount} ${t('playlist.tracks') || 'songs'}` : ''}
                        {focusedSecondaryText ? ` • ${focusedSecondaryText}` : ''}
                    </p>
                </div>
            )}
        </div>
    );
};
