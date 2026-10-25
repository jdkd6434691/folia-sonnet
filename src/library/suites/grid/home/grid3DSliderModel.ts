import type React from 'react';
import { formatGridMapFolderTitle } from '../../../../utils/gridMapFolderPath';

// src/library/suites/grid/home/grid3DSliderModel.ts
// 桌面 Grid3D 滑条的纯部分：显示文案、渲染窗口、滚动目标、转场模式与滚轮归一；滑条本身在 Grid3DSlider。

export interface Grid3DSliderItem {
    id: string | number;
    name: React.ReactNode;
    coverUrl?: string;
    description?: string;
    summary?: string;
    trackCount?: number;
    trackIds?: string[];
    type?: string;
    isVirtual?: boolean;
}

export interface Grid3DSliderProps {
    items: Grid3DSliderItem[];
    focusedIndex: number;
    onFocusedIndexChange: (index: number) => void;
    onSelect: (item: Grid3DSliderItem, index: number) => void;
    isInteractive?: boolean;
    isLoading?: boolean;
    emptyMessage?: string;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
}

const compactDescription = (description?: string, maxLength = 72) => {
    if (!description) return '';
    const normalized = description.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.substring(0, maxLength)}...` : normalized;
};

type Grid3DSliderTextItem = Pick<Grid3DSliderItem, 'type' | 'description' | 'summary'>
    & Partial<Pick<Grid3DSliderItem, 'name' | 'isVirtual'>>;

// 文件夹卡片的第二行 / 信息行显示文件夹路径（= 名称）。虚拟的「全部歌曲」没有真实路径，但同一个位置照样
// 显示它的名称（「All Songs / 全部歌曲」），不退回描述「Folder / 本地」：这是一直以来的可见文字，
// test/ui 的 local-library 截图基线锁着它。isVirtual 只用于语义判断（批量删除不按文件夹删它）。
export const getLocalFolderPath = (item: Grid3DSliderTextItem): string => (
    item.type === 'folder' && typeof item.name === 'string'
        ? item.name
        : ''
);

export const getGrid3DSliderDisplayName = (
    item: Pick<Grid3DSliderItem, 'name' | 'type' | 'isVirtual'>,
): React.ReactNode => {
    const folderPath = getLocalFolderPath(item);
    return folderPath ? formatGridMapFolderTitle(folderPath) : item.name;
};

export const getGrid3DSliderSecondaryText = (
    item: Grid3DSliderTextItem,
): string => (
    getLocalFolderPath(item)
        || (item.type === 'playlist'
        ? compactDescription(item.summary) || compactDescription(item.description)
        : compactDescription(item.description) || compactDescription(item.summary))
);

export const getGrid3DSliderSummaryText = (
    item: Pick<Grid3DSliderItem, 'type' | 'description' | 'summary'>,
): string => {
    const summary = compactDescription(item.summary);
    return summary && summary !== getGrid3DSliderSecondaryText(item) ? summary : '';
};

const DISCRETE_WHEEL_PIXEL_THRESHOLD = 40;
export const DISCRETE_WHEEL_DISTANCE_MULTIPLIER = 3;
export const GRID3D_CARD_GAP = 48;

/**
 * 手机横屏（紧凑档）的纵向预算 —— 这几个数必须与 styles/androidPhoneFit.css 里同名的样式对上，
 * 少一个卡片就会被滚动容器裁掉：
 *   `[data-grid3d-slider]` 的上下内边距、`[data-grid3d-caption]` 的高度。
 * 卡片本身在这一档是 1:1（相纸卡的素材文字被隐藏），所以比例常数是 1。
 *
 * 放大倍数也要降：`scale()` 只改绘制不改布局，卡片会以自己为中心溢出「宽 ×(倍数−1)/2」，
 * 再叠上聚焦卡那 6px 上移，同样由滚动容器的内边距兜着 —— 桌面档封面几百像素、内边距 96px
 * 兜得住，紧凑档内边距只剩 20px，倍数不降的话封面一大就又把内边距吃穿、重新被裁。
 */
export const GRID3D_COMPACT_SCROLLER_PAD_PX = 20;
export const GRID3D_COMPACT_CAPTION_PX = 36;
export const GRID3D_COMPACT_CARD_RATIO = 1;
export const GRID3D_COMPACT_PEAK_SCALE = 1.12;
export const GRID3D_COMPACT_MIN_COVER_PX = 64;

export const GRID3D_WINDOW_RADIUS = 18;
export const GRID3D_LEAP_CARDS = 4;
export const PROGRAMMATIC_SCROLL_SETTLE_PX = 3;
export const PROGRAMMATIC_SCROLL_TIMEOUT_MS = 600;
export const PROGRAMMATIC_SCROLL_IDLE_TIMEOUT_MS = 250;
export const WHEEL_SMOOTHING_SETTLE_DISTANCE = 0.5;
export const WHEEL_SMOOTHING_MIN_PROGRESS = 0.01;
export const WHEEL_SMOOTHING_MAX_DURATION_MS = 800;

export interface Grid3DWheelInput {
    delta: number;
    isDiscreteMouseWheel: boolean;
}

// Normalizes browser wheel units while keeping high-frequency trackpad input on the direct-scroll path.
export const resolveGrid3DWheelInput = (
    deltaX: number,
    deltaY: number,
    deltaMode: number,
    pageSize: number,
): Grid3DWheelInput => {
    const rawDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
    const unitScale = deltaMode === 1
        ? 32
        : deltaMode === 2
            ? Math.max(pageSize, 1)
            : 1;

    return {
        delta: rawDelta * unitScale,
        isDiscreteMouseWheel: deltaMode !== 0 || Math.abs(rawDelta) >= DISCRETE_WHEEL_PIXEL_THRESHOLD,
    };
};

/**
 * Serializes item IDs safely to prevent collision when IDs contain commas (e.g. folder paths).
 */
export const getGrid3DItemsSignature = (items: { id: string | number }[]): string =>
    JSON.stringify(items.map(item => String(item.id)));

/**
 * Calculates clamped target scrollLeft to center the card at the given index.
 */
export const getGrid3DTargetScrollLeft = (
    index: number,
    containerWidth: number,
    scrollWidth: number,
    cardPitch: number,
    coverSize: number,
    edgePadding: number,
): number => {
    const maxScrollLeft = Math.max(0, scrollWidth - containerWidth);
    const rawTarget = edgePadding + index * cardPitch + coverSize / 2 - containerWidth / 2;
    return Math.max(0, Math.min(maxScrollLeft, rawTarget));
};

/**
 * Identifies the layout the cached card centers were measured in. The card count alone is not
 * enough: `coverSize` and `edgePadding` move every card whenever a container breakpoint flips or
 * the floating player appears, and neither changes the count.
 */
export const getGrid3DCardGeometryKey = (
    cardCount: number,
    viewportWidth: number,
    firstCardWidth: number,
    firstCardOffsetLeft: number,
): string => `${cardCount}:${viewportWidth}:${firstCardWidth}:${firstCardOffsetLeft}`;

export const clampFocusedIndex = (index: number, itemCount: number) => {
    if (itemCount <= 0 || !Number.isFinite(index)) {
        return 0;
    }

    return Math.min(Math.max(0, Math.trunc(index)), itemCount - 1);
};

export const getGrid3DWindowRange = (
    focusedIndex: number,
    itemCount: number,
    radius = GRID3D_WINDOW_RADIUS,
): { start: number; end: number } => {
    const safeIndex = clampFocusedIndex(focusedIndex, itemCount);
    return {
        start: Math.max(0, safeIndex - radius),
        end: Math.min(itemCount, safeIndex + radius + 1),
    };
};

export type Grid3DTransitionMode = 'none' | 'direct' | 'leap';

/**
 * Resolves the transition mode for external focus changes:
 * - 'none': Immediate jump (list change, same index, or reduced motion).
 * - 'direct': Continuous smooth scroll within the rendered window radius.
 * - 'leap': Distant jump that stages cards near the destination before smoothly gliding in.
 */
export const resolveGrid3DTransitionMode = ({
    isListChanged,
    prevIndex,
    nextIndex,
    reduceMicroMotion = false,
}: {
    isListChanged: boolean;
    prevIndex: number;
    nextIndex: number;
    reduceMicroMotion?: boolean;
}): Grid3DTransitionMode => {
    if (reduceMicroMotion || isListChanged || prevIndex === nextIndex) {
        return 'none';
    }
    if (Math.abs(nextIndex - prevIndex) <= GRID3D_WINDOW_RADIUS) {
        return 'direct';
    }
    return 'leap';
};

/**
 * Resolves staging index and scroll direction for leap transitions.
 */
export const resolveGrid3DLeapPlan = ({
    prevIndex,
    nextIndex,
    itemCount,
    leapCards = GRID3D_LEAP_CARDS,
}: {
    prevIndex: number;
    nextIndex: number;
    itemCount: number;
    leapCards?: number;
}): { direction: number; stagingIndex: number } => {
    const direction = Math.sign(nextIndex - prevIndex);
    const stagingIndex = clampFocusedIndex(nextIndex - direction * leapCards, itemCount);
    return { direction, stagingIndex };
};
