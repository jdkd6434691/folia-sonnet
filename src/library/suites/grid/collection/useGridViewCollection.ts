import { useCallback, useMemo, type RefObject } from 'react';
import type { LocalSong, SongResult, UnifiedSong } from '../../../../types';
import type { OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { formatLocalAlbumTrackLabel } from '../../../../utils/localSongSorting';
import type { CollectionResource } from '../../../core/shared/resource.contract';
import type { CollectionMutationController } from '../../../core/collection/mutations/mutations.contract';
import { useCollectionResourceState } from '../../../core/collection/resource/useCollectionResourceState';
import { useCollectionMutationSnapshot } from '../../../core/collection/mutations/useCollectionMutations';
import { useTrackSorting } from '../../../core/collection/useTrackSorting';
import { useCollectionView } from '../../../core/collection/useCollectionView';
import { useProgressiveItemEntrance } from '../shared/useProgressiveItemEntrance';
import type { GridItem } from '../shared/PolaroidCard';
import { createLazyGridItems } from './lazyGridItems';

// src/library/suites/grid/collection/useGridViewCollection.ts
// GridView 的数据层：集合资源（加载、后台补页、错误）、变更控制器快照、来源分支、排序与筛选后的网格项。
// 原 GridView.tsx 的这段 hook 调用与 useMemo 原样搬出（依赖数组不变）。

const EMPTY_TRACKS: SongResult[] = [];
// What a page that is given no `items` has for them: the one list, render after render.
const NO_ITEMS: GridItem[] = [];

export interface GridViewCollectionParams {
    /** 宿主持有的集合资源：加载、缓存、后台补页、错误都在它里面。 */
    resource: CollectionResource | null;
    /** 集合的变更动作控制器（宿主按集合会话持有）。 */
    mutations: CollectionMutationController | null;
    collection: any;
    mode: 'collection' | 'tracks';
    /** 集合模式的网格项（不给时用 NO_ITEMS）。 */
    items?: GridItem[];
    localSongs?: LocalSong[];
    title: string;
    collectionIdentity: string;
    deferredSearchQuery: string;
    /** 拖拽中到达的分页先压住（与视口共用同一个 ref）。 */
    isDraggingRef: RefObject<boolean>;
}

export const useGridViewCollection = ({
    resource,
    mutations,
    collection,
    mode,
    items = NO_ITEMS,
    localSongs,
    title,
    collectionIdentity,
    deferredSearchQuery,
    isDraggingRef,
}: GridViewCollectionParams) => {
    // 曲目来自集合资源：加载、缓存、后台补页、错误都在资源里。拖拽中到达的分页先暂存，松手再提交——
    // 整表更新会重算网格项并重渲染整个渲染环，不能和拖拽抢主线程。
    // 删卡的退出动画也靠这道门：动画期间按住展示（holdPresentation），资源与变更控制器照常立即提交。
    const {
        snapshot: resourceSnapshot,
        flushHeld: flushHeldResourceSnapshot,
        holdPresentation,
        releasePresentation,
    } = useCollectionResourceState(resource, {
        holdBackground: () => isDraggingRef.current,
    });
    const tracks = resourceSnapshot?.tracks ?? EMPTY_TRACKS;
    const isOnlineResource = resource?.kind === 'online';
    const loading = resourceSnapshot ? resourceSnapshot.status === 'idle' || resourceSnapshot.status === 'loading' : false;
    const backgroundLoading = resourceSnapshot?.sync.status === 'syncing';
    // 后台补齐中断时记下原因和上游 offset：界面要能说明为什么少了歌，重试要从中断处续上。
    const backgroundLoadError = resourceSnapshot?.sync.status === 'interrupted'
        ? { message: resourceSnapshot.sync.message, offset: resourceSnapshot.sync.offset, cause: resourceSnapshot.sync.cause }
        : null;
    // 在线集合加载失败必须和「集合确实是空的」分开显示：两者都渲染成空网格的话，
    // provider 侧的鉴权、协议或网络故障在界面上就完全不可见。
    // 存判别式而不是成品文案：翻译要在渲染时做，切换语言才能跟着变。
    const loadError = resourceSnapshot?.error ?? null;
    // An online collection's failure, sorted into a named case (onlineFailureOf) from what was
    // thrown, which the resource hands on: the empty page and the background banner say which case
    // it is, and not the program's own sentence.
    const collectionProviderId = collection?.source === 'online' ? collection.providerId : undefined;
    const failureOf = (cause: unknown, notPublic = false): OnlineFailure => onlineFailureOf(
        { operation: 'collection', providerId: collectionProviderId },
        cause !== undefined ? { error: cause } : { detail: notPublic ? { case: 'not-public' } : {} },
    );
    const loadFailure = loadError && isOnlineResource ? failureOf(loadError.cause, loadError.kind === 'not-public') : null;
    const backgroundFailure = backgroundLoadError ? failureOf(backgroundLoadError.cause) : null;
    const collectionDetail = resourceSnapshot?.detail ?? null;
    // 变更动作的状态（订阅、每日推荐的日期与次数、进行中标记、候选歌单）、来源分支与能力都在控制器里，
    // 网格只订阅；按钮的可见 / 可点条件是原先 GridView 的分支布尔逐字搬过去的（见 collectionMutationCapabilities）。
    const mutationSnapshot = useCollectionMutationSnapshot(mutations);
    const { branches: mutationBranches, capabilities: mutationCapabilities } = mutationSnapshot;
    const isSourceActionPending = mutationSnapshot.sourceActionPending;
    const collectionSource = collection?.source as string | undefined;
    const isLocalCollection = collectionSource === 'local';
    const isNavidromeCollection = collectionSource === 'navidrome';
    const isAlbumCollection = collection?.type === 'album';
    const isDailyRecommendationsCollection = collectionSource === 'online' && collection?.type === 'daily_recommendations';
    // 「AI 主题」那一屏：云端给的是歌名，整屏可以重拉。它的 reload 会从随机一处重新开始，
    // 所以那一颗按钮既是「重来」也是「换一批」（见 core/services/cloudThemeCollection 的 reload）。
    const isCloudThemeCollection = collectionSource === 'cloud';
    // 每日推荐自带「刷新」，私人 FM 不分页；其余在线集合都能跳过缓存整张重新拉取。
    const canReloadOnlineCollection = mode === 'tracks'
        && collectionSource === 'online'
        && isOnlineResource
        && !isDailyRecommendationsCollection
        && collection?.type !== 'radio';
    /** 这一颗按键该不该出现：在线是跳过缓存重取，「AI 主题」是换一批。 */
    const canReloadThisCollection = canReloadOnlineCollection
        || (mode === 'tracks' && isCloudThemeCollection && resource?.kind === 'cloud');
    const {
        isLocalFolderCollection,
        isLocalAllSongsCollection,
        canEditOwnedPlaylist,
        canEditProviderPlaylist,
        canEditPlaylist,
        showSubscribeButton,
        isOnlineAlbum,
        canAddNavidromeToPlaylist,
    } = mutationBranches;
    // 改名成功、宿主的描述还没跟上时，显示控制器记下的新名字（不改描述本身，它可能是导航栈里共用的对象）。
    const collectionName: string | undefined = mutationSnapshot.renamedTo ?? collection?.name;
    const localSongsById = useMemo(() => new Map(localSongs?.map(song => [song.id, song])), [localSongs]);
    // 能排哪些项按数据来源算（见 songSortOptions）；选择本身跨 renderer 共用（见 useTrackSortStore）。
    const sorting = useTrackSorting({ source: collectionSource, localSongsById });
    // 专辑保留它自己的音轨顺序——排序按钮不挂在专辑上。
    const supportsTrackSorting = sorting.supported && !isAlbumCollection;
    // 命令面板那半边（core 动作）还按「是不是本地文件夹」判本地三项排序；在线歌单的排序项由
    // availableSortPresets 带过去，两边并集才是这个列表真正能排的全部。
    const supportsLocalTrackSorting = isLocalFolderCollection;
    // 只有能选专辑号排序的本地列表才挂轨道号；本地歌单等自定义顺序的列表不属于这个语境。
    const getAlbumTrackLabel = useCallback((track: SongResult): string | null => {
        if (!isLocalFolderCollection) return null;
        const localRef = (track as UnifiedSong).localRef;
        if (!localRef) return null;
        const localSong = localSongsById.get(localRef.songId);
        return localSong ? formatLocalAlbumTrackLabel(localSong) : null;
    }, [isLocalFolderCollection, localSongsById]);
    // 隐藏、本地排序、筛选与操作范围的规则见 library/core/collection/collectionView（专辑归属以本地曲库的
    // 专辑实体为准）；别的 renderer 用同一个 hook，所以同一个筛选在两边命中同一批歌。
    const localSortContext = supportsTrackSorting ? sorting.sort : null;
    const collectionView = useCollectionView({
        tracks,
        committedQuery: mode === 'tracks' ? deferredSearchQuery : '',
        localSort: localSortContext,
    });
    const {
        displayTracks,
        playableTracks,
        matchIndexes,
        contextTracks: contextActionTracks,
        occurrences: trackOccurrences,
    } = collectionView;

    // 网格项**惰性**塑形（见 lazyGridItems.ts）：length 立刻可用，真对象只在被读到下标时才塑形。
    // 原来整表 map 一遍，5000 首实测 120ms，而分页每来一页都要重算 —— 大歌单打开时卡在这里。
    // 重复序号由集合视图维护（分页追加时复用前缀），与条目键是同一份。
    const allGridItems = useMemo((): GridItem[] => {
        if (mode === 'collection') {
            return items || [];
        }
        return createLazyGridItems(displayTracks, trackOccurrences);
    }, [mode, items, displayTracks, trackOccurrences]);

    // 曲目模式按曲目本身做匹配，只取命中的网格项：不必为了筛选把整张歌单的卡片都塑形一遍。
    const gridItems = useMemo(() => {
        if (mode === 'tracks') {
            return matchIndexes ? matchIndexes.map(index => allGridItems[index]) : allGridItems;
        }
        // 集合模式（目前没有调用方）沿用对网格项的匹配。
        const query = deferredSearchQuery.trim().toLowerCase();
        if (!query) return allGridItems;

        return allGridItems.filter((item) => {
            const track = item.rawTrack;
            const searchableText = [
                item.searchText,
                typeof item.name === 'string' ? item.name : undefined,
                item.description,
                track?.album?.name,
                track?.artists?.map((artist) => artist.name).join(' '),
            ]
                .filter((value) => value !== undefined && value !== null)
                .join(' ')
                .toLowerCase();

            return searchableText.includes(query);
        });
    }, [allGridItems, deferredSearchQuery, matchIndexes, mode]);
    const hasSearchQuery = deferredSearchQuery.trim().length > 0;
    const shouldAnimateItemEntrance = useProgressiveItemEntrance(
        `${mode}:${collectionIdentity || title}`
    );

    return {
        resourceSnapshot,
        flushHeldResourceSnapshot,
        holdPresentation,
        releasePresentation,
        tracks,
        loading,
        backgroundLoading,
        backgroundLoadError,
        loadError,
        loadFailure,
        backgroundFailure,
        collectionDetail,
        mutationSnapshot,
        mutationBranches,
        mutationCapabilities,
        isSourceActionPending,
        collectionSource,
        isLocalCollection,
        isNavidromeCollection,
        isAlbumCollection,
        isDailyRecommendationsCollection,
        isCloudThemeCollection,
        canReloadThisCollection,
        isLocalFolderCollection,
        isLocalAllSongsCollection,
        canEditOwnedPlaylist,
        canEditProviderPlaylist,
        canEditPlaylist,
        showSubscribeButton,
        isOnlineAlbum,
        canAddNavidromeToPlaylist,
        collectionName,
        sorting,
        supportsTrackSorting,
        supportsLocalTrackSorting,
        getAlbumTrackLabel,
        collectionView,
        displayTracks,
        playableTracks,
        matchIndexes,
        contextActionTracks,
        trackOccurrences,
        gridItems,
        hasSearchQuery,
        shouldAnimateItemEntrance,
    };
};
