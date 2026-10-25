import { useEffect } from 'react';
import type { HexGridCoord } from '../shared/hexViewport';
import type { GridItem } from '../shared/PolaroidCard';
import { hasBlockingWindow } from '../../../../utils/keyboardTargets';
import type { SongResult } from '../../../../types';

// src/library/suites/grid/collection/useGridViewKeyboard.ts
// GridView 的键盘：Escape 阶梯（筛选 → 侧栏 → 切入面板 → 返回）与方向键在六边形网格里挑最近的一张卡。
// 原 GridView.tsx 的两个 effect 原样搬出（依赖数组不变）。

export interface GridViewKeyboardParams {
    /** 只有在场的那一个网格接键盘（退场动画期间旧网格仍挂着）。 */
    isActive: boolean;
    onBack: () => void;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    isFiltering: boolean;
    showSidePanel: boolean;
    setShowSidePanel: (open: boolean) => void;
    showCutInPanel: boolean;
    setShowCutInPanel: (open: boolean) => void;
    isEditMode: boolean;
    isPlaylistPickerOpen: boolean;
    isCreatePlaylistOpen: boolean;
    isDeleteFolderOpen: boolean;
    mode: 'collection' | 'tracks';
    gridItems: readonly GridItem[];
    focusedIndex: number;
    baseCoords: readonly HexGridCoord[];
    contextActionTracks: SongResult[];
    onSelectTrack?: (track: SongResult, queue: SongResult[]) => void;
    onSelectCollection?: (item: any) => void;
    persistNavigationState: (index: number) => void;
    centerOnIndex: (index: number, snap?: boolean) => void;
}

export const useGridViewKeyboard = ({
    isActive,
    onBack,
    searchQuery,
    setSearchQuery,
    isFiltering,
    showSidePanel,
    setShowSidePanel,
    showCutInPanel,
    setShowCutInPanel,
    isEditMode,
    isPlaylistPickerOpen,
    isCreatePlaylistOpen,
    isDeleteFolderOpen,
    mode,
    gridItems,
    focusedIndex,
    baseCoords,
    contextActionTracks,
    onSelectTrack,
    onSelectCollection,
    persistNavigationState,
    centerOnIndex,
}: GridViewKeyboardParams) => {
    useEffect(() => {
        if (!isActive) return;

        // Typing itself is the palette's now; what stays here is the Escape ladder, which is about
        // this grid's own panels and has nothing to do with the filter box.
        const handleEscape = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                (target instanceof HTMLElement && target.isContentEditable)
            ) {
                return;
            }

            // A window above (e.g. the lyrics timeline opened from the bottom bar) owns its own
            // Escape; auto-repeat would walk the whole ladder and leave the grid.
            if (event.key !== 'Escape' || event.repeat || hasBlockingWindow()) {
                return;
            }

            event.preventDefault();
            // A filter still applied is the first thing Escape undoes, as it always was.
            if (searchQuery) {
                setSearchQuery('');
            } else if (showSidePanel) {
                setShowSidePanel(false);
            } else if (showCutInPanel) {
                setShowCutInPanel(false);
            } else {
                onBack();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isActive, onBack, searchQuery, showCutInPanel, showSidePanel]);

    // Setup arrow keyboard navigation
    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target;
            if (
                target instanceof HTMLElement
                && (target.isContentEditable || Boolean(target.closest('button, input, select, textarea, a[href]')))
            ) return;

            if (e.key === 'Enter') {
                if (
                    e.repeat
                    || isEditMode
                    || isFiltering
                    || showSidePanel
                    || showCutInPanel
                    || isPlaylistPickerOpen
                    || isCreatePlaylistOpen
                    || isDeleteFolderOpen
                ) return;

                const focusedItem = gridItems[focusedIndex];
                if (!focusedItem) return;
                if (mode === 'tracks' && onSelectTrack && focusedItem.rawTrack) {
                    e.preventDefault();
                    persistNavigationState(focusedIndex);
                    onSelectTrack(focusedItem.rawTrack, contextActionTracks);
                } else if (mode === 'collection' && onSelectCollection) {
                    e.preventDefault();
                    onSelectCollection(focusedItem.rawCollection || focusedItem);
                }
                return;
            }

            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                if (gridItems.length === 0) return;

                const curr = baseCoords[focusedIndex];
                let bestNextIdx = focusedIndex;
                let minDist = Infinity;

                baseCoords.forEach((coord, idx) => {
                    if (idx === focusedIndex) return;

                    const dx = coord.baseX - curr.baseX;
                    const dy = coord.baseY - curr.baseY;

                    let isMatch = false;
                    if (e.key === 'ArrowLeft' && dx < -50 && Math.abs(dy) < 180) isMatch = true;
                    if (e.key === 'ArrowRight' && dx > 50 && Math.abs(dy) < 180) isMatch = true;
                    if (e.key === 'ArrowUp' && dy < -50 && Math.abs(dx) < 200) isMatch = true;
                    if (e.key === 'ArrowDown' && dy > 50 && Math.abs(dx) < 200) isMatch = true;

                    if (isMatch) {
                        const dist = dx * dx + dy * dy;
                        if (dist < minDist) {
                            minDist = dist;
                            bestNextIdx = idx;
                        }
                    }
                });

                if (bestNextIdx !== focusedIndex) {
                    centerOnIndex(bestNextIdx, true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        baseCoords,
        contextActionTracks,
        focusedIndex,
        gridItems,
        isCreatePlaylistOpen,
        isDeleteFolderOpen,
        isEditMode,
        isActive,
        isPlaylistPickerOpen,
        mode,
        onSelectCollection,
        onSelectTrack,
        persistNavigationState,
        isFiltering,
        showCutInPanel,
        showSidePanel,
    ]);
};

