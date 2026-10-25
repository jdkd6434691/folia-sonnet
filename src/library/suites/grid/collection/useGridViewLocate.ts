import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SongResult } from '../../../../types';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../../stores/usePlayingSongLocatorStore';
import { answerLocateRequest, locatePlayingSongOnPage } from '../../../../components/app/playing-song-locator/playingSongLocator';
import { resolveLocateStep } from '../../../../components/app/playing-song-locator/resolveLocateStep';
import { collectionKey } from '../../../core/collection/collectionIdentity';
import type { GridItem } from '../shared/PolaroidCard';

// src/library/suites/grid/collection/useGridViewLocate.ts
// GridView 回答「正在播放的那首在哪」：定位按钮的状态、侧栏要滚到哪一行，以及请求的答复。
// 原 GridView.tsx 的这段 useMemo / useState / effect 原样搬出（依赖数组与日志一字不改）。

export interface GridViewLocateParams {
    mode: 'collection' | 'tracks';
    displayTracks: SongResult[];
    gridItems: readonly GridItem[];
    hasSearchQuery: boolean;
    focusedIndex: number;
    /** 应用导航认识的这一页的 key。 */
    navigationKey?: string;
    collection: any;
    /** 只有在场的那一个网格回答（退场动画期间旧网格仍挂着）。 */
    isActive: boolean;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    isLoading: boolean;
    loading: boolean;
    backgroundLoading: boolean;
    loadError: unknown;
    backgroundLoadError: unknown;
    centerOnIndex: (index: number, snap?: boolean) => void;
}

export const useGridViewLocate = ({
    mode,
    displayTracks,
    gridItems,
    hasSearchQuery,
    focusedIndex,
    navigationKey,
    collection,
    isActive,
    searchQuery,
    setSearchQuery,
    isLoading,
    loading,
    backgroundLoading,
    loadError,
    backgroundLoadError,
    centerOnIndex,
}: GridViewLocateParams) => {
    // "Where is the song that is playing" (app/playing-song-locator/playingSongLocator.ts): this page answers the
    // question put to it. A song among its cards is centred. One that is not is reported once no
    // filter hides any card: at once to the page's own button, and to a question the page was
    // opened for once no further card can come. The answer is that the song is not here where
    // the list is whole, and that the page cannot tell where it is not (cards are still to come,
    // or the reading failed). Declared after the effects that place the grid when it opens, so
    // that on a page opened for this the song's card is where it ends.
    const playingSongKey = usePlaybackStore(state => (state.currentSong ? getPlaybackSongKey(state.currentSong) : null));
    const locateRequest = usePlayingSongLocatorStore(state => state.request);
    const isPlayingSongHere = useMemo(() => (
        mode === 'tracks' && playingSongKey !== null && displayTracks.some(track => getPlaybackSongKey(track) === playingSongKey)
    ), [displayTracks, mode, playingSongKey]);
    // Further cards may still come while the resource reads its first page or fills the rest in
    // the background; a read that failed (the first page, a page of the background fill, or a
    // Navidrome read) brings nothing more and leaves the list short of what it did not reach. The
    // snapshot says both in one update with the tracks they speak of.
    const hasReadFailed = Boolean(loadError || backgroundLoadError);
    const cardsStillArriving = isLoading || loading || backgroundLoading;
    const pageKey = navigationKey ?? collectionKey(collection);
    const isLocateAsked = locateRequest !== null && mode === 'tracks' && locateRequest.collectionKey === pageKey;
    const locateOnThisPage = useCallback(() => locatePlayingSongOnPage(pageKey), [pageKey]);
    // Counts the times the song was found: the list beside the grid goes to its row each time,
    // also when the grid already stood on its card.
    const [locatedTimes, setLocatedTimes] = useState(0);
    // The row of the focused card in that list. The list holds every track; under a filter the
    // grid has fewer cards, and the card's index among them is another song's row.
    const listFocusedIndex = useMemo(() => {
        const track = hasSearchQuery ? gridItems[focusedIndex]?.rawTrack : undefined;
        const row = track ? displayTracks.indexOf(track) : -1;
        return row >= 0 ? row : focusedIndex;
    }, [displayTracks, focusedIndex, gridItems, hasSearchQuery]);
    useEffect(() => {
        if (!locateRequest || !isActive || !isLocateAsked) return;
        const index = gridItems.findIndex(item => item.rawTrack !== undefined && getPlaybackSongKey(item.rawTrack) === locateRequest.songKey);
        const step = resolveLocateStep({
            isHere: index >= 0,
            isFiltered: Boolean(searchQuery || hasSearchQuery),
            waits: locateRequest.waits,
            cardsStillArriving,
            hasReadFailed,
        });
        if (step.kind === 'wait') return;
        if (step.kind === 'unfilter') {
            // A filter may be what hides it: it is looked for again among all the cards.
            if (searchQuery) setSearchQuery('');
            return;
        }
        if (step.answer === true) {
            centerOnIndex(index, true);
            setLocatedTimes(times => times + 1);
        } else if (step.answer === 'unread') {
            // Why the page took its list for not whole, for the day a listener sees a whole one called so.
            console.log(`[Locate] The list is not whole: ${displayTracks.length} tracks, reading ${isLoading || loading}, filling up ${backgroundLoading}, failed ${hasReadFailed}`);
        }
        answerLocateRequest(locateRequest.nonce, step.answer);
    }, [backgroundLoading, cardsStillArriving, displayTracks.length, gridItems, hasReadFailed, hasSearchQuery, isActive, isLoading, isLocateAsked, loading, locateRequest, searchQuery]);

    return {
        playingSongKey,
        isPlayingSongHere,
        isLocateAsked,
        locateOnThisPage,
        locatedTimes,
        listFocusedIndex,
    };
};
