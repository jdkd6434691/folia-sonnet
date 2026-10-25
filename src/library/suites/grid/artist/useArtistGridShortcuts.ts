import type React from 'react';
import { useEffect } from 'react';
import type { SongResult } from '../../../../types';
import type { ArtistView } from '../../../core/artist/useArtistView';
import { hasBlockingWindow } from '../../../../utils/keyboardTargets';
import type { HexGridCoord } from '../shared/hexViewport';
import type { GridItem } from './artistGridLayout';

// src/library/suites/grid/artist/useArtistGridShortcuts.ts
// 歌手页的键盘：Escape 逐层收起面板，Enter 打开当前卡，方向键在六边形网格里找相邻的卡。
// 两者的判断与依赖与原先写在 ArtistGridView 里的完全一致。

type ArtistGridShortcutsParams = {
    isInteractive: boolean;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    showSidePanel: boolean;
    setShowSidePanel: (open: boolean) => void;
    showCutInPanel: boolean;
    setShowCutInPanel: (open: boolean) => void;
    showFullBio: boolean;
    setShowFullBio: React.Dispatch<React.SetStateAction<boolean>>;
    onBack: () => void;
    hasArtist: boolean;
    focusedIndex: number;
    gridItems: GridItem[];
    baseCoords: HexGridCoord[];
    isFiltering: boolean;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    artistActions: ArtistView['actions'];
    canPlaySong: boolean;
    canOpenAlbum: boolean;
    persistNavigationState: (index: number) => void;
    centerOnIndex: (index: number, snap?: boolean) => void;
};

export const useArtistGridShortcuts = ({
    isInteractive,
    searchQuery,
    setSearchQuery,
    showSidePanel,
    setShowSidePanel,
    showCutInPanel,
    setShowCutInPanel,
    showFullBio,
    setShowFullBio,
    onBack,
    hasArtist,
    focusedIndex,
    gridItems,
    baseCoords,
    isFiltering,
    onSelectAlbum,
    artistActions,
    canPlaySong,
    canOpenAlbum,
    persistNavigationState,
    centerOnIndex,
}: ArtistGridShortcutsParams) => {
    useEffect(() => {
        if (!isInteractive) return;

        // Typing itself is the palette's now; what stays here is the Escape ladder, which is about
        // this grid's own panels and has nothing to do with the filter box.
        const handleEscape = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                (target instanceof HTMLElement && target.isContentEditable)
            ) return;

            // Same as GridView: a window above owns Escape, and auto-repeat must not leave the grid.
            if (event.key !== 'Escape' || event.repeat || hasBlockingWindow()) return;

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
    }, [isInteractive, onBack, searchQuery, showCutInPanel, showSidePanel]);

    // Setup arrow keyboard navigation
    useEffect(() => {
        if (!isInteractive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target;
            if (
                target instanceof HTMLElement
                && (target.isContentEditable || Boolean(target.closest('button, input, select, textarea, a[href]')))
            ) return;

            if (e.key === 'Enter') {
                if (e.repeat || isFiltering || showSidePanel || showCutInPanel || showFullBio) return;

                const focusedItem = gridItems[focusedIndex];
                if (!focusedItem) return;
                if (focusedIndex === 1) {
                    e.preventDefault();
                    setShowFullBio(true);
                } else if (focusedItem.rawTrack && canPlaySong) {
                    e.preventDefault();
                    persistNavigationState(focusedIndex);
                    artistActions.playSong(focusedItem.rawTrack);
                } else if (focusedItem.rawCollection && onSelectAlbum && canOpenAlbum) {
                    e.preventDefault();
                    persistNavigationState(focusedIndex);
                    onSelectAlbum(focusedItem.rawCollection.id, focusedItem.rawCollection);
                }
                return;
            }

            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                if (!hasArtist) return;

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
        focusedIndex,
        gridItems,
        hasArtist,
        isInteractive,
        onSelectAlbum,
        artistActions,
        canPlaySong,
        canOpenAlbum,
        persistNavigationState,
        showCutInPanel,
        isFiltering,
        showFullBio,
        showSidePanel,
    ]);
};
