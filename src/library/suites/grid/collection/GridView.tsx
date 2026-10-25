import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, animate, useDragControls, useIsPresent } from 'framer-motion';
import GridPanelToggleIndicator from '../shared/GridPanelToggleIndicator';
import { useTranslation } from 'react-i18next';
import { SongResult, type LocalSong, type StatusMessage, Theme } from '../../../../types';
import { getLowResCoverUrl, toHttps } from './gridViewText';
import GridViewCutInPanel from './GridViewCutInPanel';
import GridViewChrome from './GridViewChrome';
import { useGridViewLayout } from './useGridViewLayout';
import { useGridViewViewport } from './useGridViewViewport';
import { useGridViewCards } from './useGridViewCards';
import { useGridViewMutations } from './useGridViewMutations';
import { useGridViewKeyboard } from './useGridViewKeyboard';
import { useGridViewLocate } from './useGridViewLocate';
import { useGridViewCollection } from './useGridViewCollection';
import { useGridViewStandIn } from './useGridViewStandIn';
import { useGridViewSurface } from './useGridViewSurface';
import GridViewStandInCard from './GridViewStandInCard';
import GridViewCanvas from './GridViewCanvas';
import GridViewDialogs from './GridViewDialogs';
import GridViewTracksPanel from './GridViewTracksPanel';
import { onlineFailureMessage } from '../../../../services/onlineMusic/failure/onlineFailureTexts';
import { GridLocateButton } from '../../../../components/app/playing-song-locator/GridLocateButton';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../../stores/usePlayingSongLocatorStore';
import { resolveLocateStep } from '../../../../components/app/playing-song-locator/resolveLocateStep';
import { useFoliaHexViewport } from '../shared/useFoliaHexViewport';
import { PolaroidCard, type GridItem } from '../shared/PolaroidCard';
import type { GridPlaybackMark } from '../shared/useGridStayPlayback';
import { gridViewStateStorageKey, readStoredGridViewState, resolveGridRestoreTarget, type GridRestoreTarget } from '../shared/gridViewRestore';
import { useMorphPageExit } from '../transitions/collectionMorphStore';
import { type CollectionMorphPlan } from '../transitions/morphGeometry';
import ActiveGridMarker from '../shared/ActiveGridMarker';
import PlaylistSelectionDialog from '../../../../components/shared/PlaylistSelectionDialog';
import TextInputDialog from '../../../../components/shared/TextInputDialog';
import ConfirmDialog from '../../../../components/shared/ConfirmDialog';
import { SidePanelList } from '../../../../components/shared/SidePanelList';
import { GridListSearchButton } from '../../../../components/shared/GridListSearchButton';
import { TrackSortMenu } from '../../../../components/shared/TrackSortMenu';
import { CustomSelect } from '../../../../components/shared/CustomSelect';
import { deriveProgressiveLoadingState } from '../shared/progressiveGrid';
import { useProgressiveItemEntrance } from '../shared/useProgressiveItemEntrance';
import { useLocalCoverPreloader } from '../../../../hooks/useLocalCoverPreloader';
import { resolveCollectionSyncCounts } from '../../../core/collection/collectionProgress';
import { useGridSurfaceRegistration } from '../../../../hooks/useGridSurfaceRegistration';
import type { CollectionResource } from '../../../core/shared/resource.contract';
import type { CollectionMutationController } from '../../../core/collection/mutations/mutations.contract';
import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import { useGridViewSettingsStore } from '../../../../stores/useGridViewSettingsStore';
import { collectionKey } from '../../../core/collection/collectionIdentity';
import { useCollectionResourceState } from '../../../core/collection/resource/useCollectionResourceState';
import { useCollectionView } from '../../../core/collection/useCollectionView';
import { useCommittedQuery } from '../../../core/shared/useCommittedQuery';
import { useLibrarySessionQuery } from '../../../core/shared/useLibrarySessionQuery';
import { useGridCommandFilter } from '../../../../hooks/useGridCommandFilter';
import { getLibraryBrowseSession, useLibraryBrowseSessionStore } from '../../../core/shared/useLibraryBrowseSessionStore';
import { useTrackSorting } from '../../../core/collection/useTrackSorting';

interface GridViewProps {
    title: string;
    subtitle?: string;
    items?: GridItem[];
    mode: 'collection' | 'tracks';
    onBack: () => void;
    /** 返回按钮：看完了（宿主清会话与布局记录再返回）。 */
    onDone: () => void;
    onSelectTrack?: (track: SongResult, queue: SongResult[]) => void;
    onSelectCollection?: (item: any) => void;
    onAddTrackToQueue?: (track: SongResult) => void;
    /** fb3：「留在原处」时正在播放的那首的卡片画成暂停 / 继续（useGridStayPlayback.markFor）；不给就是普通的播放键。 */
    trackPlaybackMark?: (track: SongResult | undefined) => GridPlaybackMark | null;
    isLoading?: boolean;
    theme: Theme;
    isDaylight: boolean;

    // Optional self-contained collection props
    collection?: any;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[], options?: { suppressToast?: boolean }) => number | void;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    /**
     * 曲目的来源：加载、缓存、后台补页、错误与重新拉取都在资源里（见 library/core/collection/resource）。
     * 宿主持有它，切换 renderer 不会重新请求。
     */
    resource?: CollectionResource | null;
    /**
     * 集合的变更动作控制器（宿主按集合会话持有，见 library/core/collection/mutations/collectionMutations.service）：删条目、订阅、
     * 改名、删除、重扫、导出、加入歌单……都经它，按钮的可见与可点也读它的快照。没有时（性能探针）什么都不支持。
     */
    mutations?: CollectionMutationController | null;
    localSongs?: LocalSong[];
    onStatusMessage?: (message: StatusMessage) => void;
    isInteractive?: boolean;
    /**
     * The key the app's navigation knows this page by: collectionKey of the descriptor it was
     * opened with. `collection` may be a refreshed copy with another key (a local album or artist
     * takes the id of the entity it was merged into).
     */
    navigationKey?: string;
    /**
     * Optional shared-element「移形换影」plan, as it stands when the page is
     * first rendered. Either way every non-hero card settles into its grid
     * slot from a short push, in a distance sequence; `kind: 'morph'`
     * additionally means a cover is flying to this page: the page puts up a
     * stand-in card at the hero's place, showing the plan's `coverUrl`, for
     * the cover to land on, which then hands over to the hero. `kind:
     * 'cascade'` (no cover flying) leaves the hero visible. Absent for every
     * other caller, so behavior is unchanged unless the collection morph
     * hands it in.
     */
    morphPlan?: CollectionMorphPlan | null;
    /**
     * 网格 suite 在 entry.ts 里为集合 surface 声明的动作（宿主经 registry 解析后传入）。命令面板只发布
     * 声明过的；直接挂 GridView 的探针不传，不过滤。
     */
    declaredActions?: LibraryDeclaredActions;
}

// What a page that is given no `items` has for them: the one list, render after render. A list
// made anew in every render made the grid's items anew, and with them every card on the page.
const NO_ITEMS: GridItem[] = [];

export const GridView: React.FC<GridViewProps> = ({
    title,
    subtitle,
    items = NO_ITEMS,
    mode,
    onBack,
    onDone,
    onSelectTrack,
    onSelectCollection,
    onAddTrackToQueue,
    trackPlaybackMark,
    isLoading = false,
    theme,
    isDaylight,
    collection,
    onPlayAll,
    onAddAllToQueue,
    onSelectAlbum,
    onSelectArtist,
    resource = null,
    mutations = null,
    localSongs,
    onStatusMessage,
    isInteractive = true,
    navigationKey,
    morphPlan = null,
    declaredActions,
}) => {
    const { t } = useTranslation();
    const fullBleedCover = useGridViewSettingsStore(state => state.gridViewFullBleedCover);
    // Only the full-bleed layout can be square: the polaroid frame needs the extra height for the
    // printed label under its artwork.
    const squareCards = useGridViewSettingsStore(state => state.gridViewSquareCards) && fullBleedCover;
    const minCardScale = useGridViewSettingsStore(state => state.gridViewMinCardScale);
    const minCardOpacity = useGridViewSettingsStore(state => state.gridViewMinCardOpacity);
    const pageExit = useMorphPageExit();
    const containerRef = useRef<HTMLDivElement>(null);
    const dragControls = useDragControls();
    const isDraggingRef = useRef(false);

    const {
        containerSize,
        layoutConfig,
        clipRadius,
        cardFrameOptions,
        renderRadius,
        renderRing,
    } = useGridViewLayout({ containerRef, squareCards, minCardScale, minCardOpacity });
    // 恢复记录按集合身份分开存：只用 id 时，不同来源、不同 provider 下同 id 的集合会互相恢复对方的焦点和筛选。
    const collectionIdentity = collection?.source ? collectionKey(collection) : '';
    const navigationStorageKey = useMemo(() => {
        if (mode !== 'tracks' || !collection) return null;
        return gridViewStateStorageKey(collectionIdentity || collection.name || title);
    }, [collection, collectionIdentity, mode, title]);
    // 浏览会话（筛选词、看到哪首）的键：与列表等别的 renderer 共用，换 renderer 时会话还在。
    const sessionKey = collectionIdentity || `${mode}:${title}`;
    // 恢复目标在挂载时定下（网格按集合 key 挂载）：恢复 effect 和移形换影的 hero 用同一份。
    const [initialRestoreTarget] = useState<GridRestoreTarget | null>(() => (
        navigationStorageKey
            ? resolveGridRestoreTarget(readStoredGridViewState(navigationStorageKey), getLibraryBrowseSession(sessionKey))
            : null
    ));

    const [showCutInPanel, setShowCutInPanel] = useState(false);
    const [showSidePanel, setShowSidePanel] = useState(false);
    // 退场动画期间旧网格仍挂着：只有在场的那一个接键盘、筛选框和命令面板，
    // 否则在上一个网格还没退完时按下的 Enter 会落到它身上。
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    // The filter box is the command palette now; this grid only says who owns typing and where the
    // box belongs. See useGridCommandFilter for why all three grids stopped carrying their own.
    // 筛选词存在浏览会话里（见 useLibrarySessionQuery），换 renderer 不丢。
    const { query: searchQuery, setQuery: setSearchQuery, port: searchQueryPort } = useLibrarySessionQuery(sessionKey);
    const isFiltering = useGridCommandFilter({
        isInteractive: isActive,
        port: searchQueryPort,
        // The box used to be an absolutely positioned child of the canvas; it still is.
        anchorRef: containerRef,
        reopenIfFiltered: true,
    });
    const deferredSearchQuery = useCommittedQuery(searchQuery);

    const {
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
    } = useGridViewCollection({
        resource,
        mutations,
        collection,
        mode,
        items,
        localSongs,
        title,
        collectionIdentity,
        deferredSearchQuery,
        isDraggingRef,
    });

    const {
        removingTrackKeys,
        isEditMode,
        setEditableTitle,
        editableTitle,
        isPlaylistPickerOpen,
        setIsPlaylistPickerOpen,
        isCreatePlaylistOpen,
        setIsCreatePlaylistOpen,
        isDeleteFolderOpen,
        setIsDeleteFolderOpen,
        pendingLocalRemoval,
        setPendingLocalRemoval,
        canRename,
        canMatchSong,
        handleSourceEditToggle,
        handleDeleteSourceCollection,
        handleResyncLocalFolder,
        handleResyncAllLocalFolders,
        handleExportLocalPlaylist,
        handleOrganizeSongInfo,
        handleEditEntity,
        handleAddNavidromeCollectionToPlaylist,
        handleCreateNavidromePlaylist,
        resumeBackgroundSync,
        reloadOnlineCollection,
        handleEditModeToggle,
        playlistSubscribed,
        starPresses,
        handleToggleSubscribe,
        handleDailyRecommendationDateChange,
        confirmLocalSongRemoval,
        runRemoveTrack,
        handleRemoveTrack,
    } = useGridViewMutations({
        title,
        collection,
        collectionName,
        mutations,
        mutationSnapshot,
        mutationCapabilities,
        mutationBranches,
        playableTracks,
        resource,
        holdPresentation,
        releasePresentation,
        onBack,
        onStatusMessage,
        isLocalFolderCollection,
        isLocalAllSongsCollection,
        isDailyRecommendationsCollection,
        t,
    });


    // 重复序号由集合视图维护（分页追加时复用前缀），与条目键是同一份。


    const {
        dragX,
        dragY,
        dragBounds,
        focusedIndex,
        focusedIndexRef,
        pendingFocusCommitTimeoutRef,
        baseCoords,
        renderedIndexes,
        renderedIndexesRef,
        updateRenderedIndexesForViewport,
        centerOnIndex,
        commitFocusedIndex,
        scheduleFocusedIndexCommit,
        persistNavigationState,
        pendingRestoreStateRef,
        hasRestoredNavigationRef,
    } = useGridViewViewport({
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
        findEntryIndex: collectionView.findEntryIndex,
        matchIndexes,
    });

    // Centre on the first card when cards first appear, and when the filter changes which ones
    // are shown. Not when further cards join the ones there: an online collection is read page
    // by page (15 or 100 songs a page on YouTube Music), and every page that arrived pulled the
    // listener back to the first card from wherever they had scrolled to.
    const firstCardShownForRef = useRef<string | null>(null);
    useEffect(() => {
        if (gridItems.length === 0) {
            firstCardShownForRef.current = null;
            return;
        }
        if (pendingRestoreStateRef.current && !hasRestoredNavigationRef.current) return;
        const shownFor = firstCardShownForRef.current;
        firstCardShownForRef.current = deferredSearchQuery;
        if (hasRestoredNavigationRef.current) return;
        if (shownFor !== deferredSearchQuery) {
            centerOnIndex(0, false);
        }
    }, [deferredSearchQuery, gridItems.length]);

    useGridViewKeyboard({
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
    });

    useEffect(() => {
        updateRenderedIndexesForViewport(dragX.get(), dragY.get(), true);
    }, [dragX, dragY, updateRenderedIndexesForViewport]);

    // 替身卡（移形换影）：入场计划与交棒见 useGridViewStandIn，画出来的是 GridViewStandInCard。
    const { standIn, standInCardRef, entranceKind } = useGridViewStandIn({
        morphPlan,
        readHandoverInputs: () => ({
            showLoading,
            gridItemCount: gridItems.length,
            renderedIndexCount: renderedIndexes.length,
            cardWrapperRefs,
            morphHeroIndex,
        }),
    });

    // 卡片层（入场 hero、卡片节点与集中式帧循环）见 useGridViewCards。
    const { cards: memoizedCards, cardWrapperRefs, morphHeroIndex } = useGridViewCards({
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
        findEntryIndex: collectionView.findEntryIndex,
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
        onRemoveTrack: handleRemoveTrack,
        persistNavigationState,
        centerOnIndex,
        isDraggingRef,
        t,
    });

    const progressiveLoading = deriveProgressiveLoadingState(
        gridItems.length,
        isLoading || (mode === 'tracks' && loading),
        backgroundLoading
    );
    const showLoading = progressiveLoading.initialLoading;
    const {
        playingSongKey,
        isPlayingSongHere,
        isLocateAsked,
        locateOnThisPage,
        locatedTimes,
        listFocusedIndex,
    } = useGridViewLocate({
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
    });
    // 大歌单要分几十页补齐，只写「加载中」用户会以为歌丢了；拿得到总数就把进度写出来。
    const backgroundSyncTotal = collectionDetail?.trackCount ?? collection?.trackCount;
    const backgroundSyncCounts = resolveCollectionSyncCounts(tracks.length, backgroundSyncTotal);
    const backgroundSyncLabel = backgroundLoadError
        ? (backgroundSyncCounts ? t('playlist.syncInterruptedProgress', backgroundSyncCounts) : t('playlist.syncInterrupted'))
        : (backgroundSyncCounts ? t('playlist.syncProgress', backgroundSyncCounts) : t('playlist.loading'));
    // What went wrong, said in the empty page and in the background banner's hover text.
    const loadFailureSaid = loadFailure && !hasSearchQuery ? onlineFailureMessage(loadFailure, t) : null;
    const backgroundFailureSaid = backgroundFailure ? onlineFailureMessage(backgroundFailure, t) : null;

    const displayCollection = mutationSnapshot.renamedTo && collection ? { ...collection, name: mutationSnapshot.renamedTo } : collection;
    const infoCollection = collectionDetail ? { ...displayCollection, ...collectionDetail } : displayCollection;
    const coverUrl = infoCollection?.coverUrl || '';
    // 只有 tracks 模式下的合集才有切入面板，没有面板时标题不做成可点控件
    const hasCutInPanel = mode === 'tracks' && Boolean(collection);

    // 命令面板的集合 surface（core 动作 + 网格自己的面板 / 侧栏 / 编辑模式）见 useGridViewSurface。
    useGridViewSurface({
        isInteractive: isActive,
        declaredActions,
        contextActionTracks,
        hasSearchQuery,
        supportsLocalTrackSorting,
        supportsTrackSorting,
        sorting,
        canReloadThisCollection,
        loading,
        onPlayAll,
        onAddAllToQueue,
        reloadOnlineCollection,
        mutationSnapshot,
        mutations,
        hasCutInPanel,
        mode,
        displayTrackCount: displayTracks.length,
        canEditPlaylist,
        isCutInPanelOpen: showCutInPanel,
        isTrackListOpen: showSidePanel,
        isEditMode,
        toggleInfoPanel: () => setShowCutInPanel(current => !current),
        toggleTrackList: () => setShowSidePanel(current => !current),
        toggleEditMode: handleEditModeToggle,
    });

    const albumArtists = Array.isArray(infoCollection?.artists) ? infoCollection.artists : [];
    const albumAlias = infoCollection?.aliases?.[0];
    const albumPublishedAt = infoCollection?.publishedAt;
    const albumPublisher = infoCollection?.publisher;

    return (
        <motion.div
            data-ponder-page-scope="grid-view-page"
            data-library-renderer="grid"
            data-library-surface="collection"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={pageExit}
            className="fixed inset-0 z-[110] flex flex-col justify-between overflow-hidden select-none"
            style={{
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-primary)',
            }}
        >
            {coverUrl && (
                <div
                    className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
                    style={{ opacity: isDaylight ? 0.18 : 0.12 }}
                >
                    <img
                        src={toHttps(getLowResCoverUrl(coverUrl))}
                        alt=""
                        className="w-full h-full object-cover scale-110 filter blur-[30px]"
                    />
                </div>
            )}
            {/* 「我是当前这层网格」的标记，放在根节点里：移形换影的测量只在这个子树里找卡片和
                落点，否则正在退出的上一层网格会被当成落点。订阅关在子组件里，见 ActiveGridMarker。 */}
            <ActiveGridMarker />

            {/* Back Button / 后台补页 / AI 主题换一批 / 中间标题 */}
            <GridViewChrome
                onDone={onDone}
                isDaylight={isDaylight}
                showBackgroundSync={Boolean(progressiveLoading.backgroundLoading || backgroundLoadError) && !isCloudThemeCollection}
                backgroundLoading={progressiveLoading.backgroundLoading}
                backgroundLoadError={Boolean(backgroundLoadError)}
                backgroundSyncLabel={backgroundSyncLabel}
                backgroundFailureSaid={backgroundFailureSaid}
                onResumeBackgroundSync={resumeBackgroundSync}
                isCloudThemeCollection={isCloudThemeCollection}
                canReloadThisCollection={canReloadThisCollection}
                loading={loading}
                onReloadCollection={reloadOnlineCollection}
                hasCutInPanel={hasCutInPanel}
                isCutInPanelOpen={showCutInPanel}
                onToggleCutInPanel={() => setShowCutInPanel(!showCutInPanel)}
                heading={infoCollection?.name || collectionName || title}
                subtitle={subtitle}
                description={infoCollection?.description}
            />

            {/* Honeycomb Drag/Viewport Canvas Area */}
            <GridViewCanvas
                containerRef={containerRef}
                dragControls={dragControls}
                showLoading={showLoading}
                hasStandIn={Boolean(standIn)}
                gridItemCount={gridItems.length}
                loadFailureSaid={loadFailureSaid}
                hasSearchQuery={hasSearchQuery}
                loadError={loadError}
                dragBounds={dragBounds}
                dragX={dragX}
                dragY={dragY}
                onDragStart={() => {
                    if (pendingFocusCommitTimeoutRef.current) {
                        clearTimeout(pendingFocusCommitTimeoutRef.current);
                        pendingFocusCommitTimeoutRef.current = null;
                    }
                    isDraggingRef.current = true;
                }}
                onDragEnd={() => {
                    setTimeout(() => {
                        isDraggingRef.current = false;
                        flushHeldResourceSnapshot();
                        scheduleFocusedIndexCommit(140);
                    }, 50);
                }}
                cards={memoizedCards}
            />

                <GridViewStandInCard
                    standIn={standIn}
                    standInCardRef={standInCardRef}
                    fullBleedCover={fullBleedCover}
                    cardWidth={layoutConfig.cardWidth}
                    cardHeight={layoutConfig.cardHeight}
                    isDaylight={isDaylight}
                    showLoading={showLoading}
                    collectionName={collectionName}
                    title={title}
                />

            {/* Cut-in Info Panel Overlay */}
            <GridViewCutInPanel
                isOpen={showCutInPanel && hasCutInPanel}
                title={title}
                infoCollection={infoCollection}
                coverUrl={coverUrl}
                actionsPonderTarget={isLocalCollection ? 'local-folder-actions' : 'online-collection-actions'}
                isDaylight={isDaylight}
                theme={theme}
                isLocalCollection={isLocalCollection}
                isLocalFolderCollection={isLocalFolderCollection}
                isNavidromeCollection={isNavidromeCollection}
                isAlbumCollection={isAlbumCollection}
                isDailyRecommendationsCollection={isDailyRecommendationsCollection}
                isCloudThemeCollection={isCloudThemeCollection}
                collection={collection}
                loading={loading}
                hasSearchQuery={hasSearchQuery}
                displayTrackCount={displayTracks.length}
                contextActionTracks={contextActionTracks}
                playableTracks={playableTracks}
                albumAlias={albumAlias}
                albumArtists={albumArtists}
                albumPublishedAt={albumPublishedAt}
                albumPublisher={albumPublisher}
                mutationSnapshot={mutationSnapshot}
                mutationCapabilities={mutationCapabilities}
                isSourceActionPending={isSourceActionPending}
                canRename={canRename}
                isEditMode={isEditMode}
                editableTitle={editableTitle}
                onEditableTitleChange={setEditableTitle}
                onToggleSourceEdit={handleSourceEditToggle}
                onEditEntity={handleEditEntity}
                onToggleEditMode={handleEditModeToggle}
                canEditPlaylist={canEditPlaylist}
                canReloadThisCollection={canReloadThisCollection}
                onReloadCollection={reloadOnlineCollection}
                canAddNavidromeToPlaylist={canAddNavidromeToPlaylist}
                onOpenPlaylistPicker={() => setIsPlaylistPickerOpen(true)}
                onRequestDeleteFolder={() => setIsDeleteFolderOpen(true)}
                onDeleteCollection={handleDeleteSourceCollection}
                confirmLocalSongRemoval={confirmLocalSongRemoval}
                onExportPlaylist={handleExportLocalPlaylist}
                onResyncFolder={handleResyncLocalFolder}
                onResyncAllFolders={handleResyncAllLocalFolders}
                onOrganizeSongInfo={handleOrganizeSongInfo}
                showSubscribeButton={showSubscribeButton}
                playlistSubscribed={playlistSubscribed}
                isOnlineAlbum={isOnlineAlbum}
                starPresses={starPresses}
                onToggleSubscribe={handleToggleSubscribe}
                onDailyDateChange={handleDailyRecommendationDateChange}
                onPlayAll={onPlayAll}
                onAddAllToQueue={onAddAllToQueue}
                onSelectArtist={onSelectArtist}
            />

            <GridViewDialogs
                isPlaylistPickerOpen={isPlaylistPickerOpen}
                playlists={mutationSnapshot.availablePlaylists}
                isCreatePlaylistOpen={isCreatePlaylistOpen}
                pendingLocalRemoval={pendingLocalRemoval}
                isDeleteFolderOpen={isDeleteFolderOpen}
                collectionName={collection?.name}
                isDaylight={isDaylight}
                onClosePlaylistPicker={() => setIsPlaylistPickerOpen(false)}
                onSelectPlaylist={(playlistId) => {
                    void handleAddNavidromeCollectionToPlaylist(playlistId);
                }}
                onRequestCreatePlaylist={() => setIsCreatePlaylistOpen(true)}
                onCloseCreatePlaylist={() => setIsCreatePlaylistOpen(false)}
                onCreatePlaylist={(name) => {
                    void handleCreateNavidromePlaylist(name);
                }}
                onConfirmLocalRemoval={(pending) => {
                    setPendingLocalRemoval(null);
                    void runRemoveTrack(pending.track, pending.entryKey);
                }}
                onCloseLocalRemoval={() => setPendingLocalRemoval(null)}
                onConfirmDeleteFolder={() => {
                    setIsDeleteFolderOpen(false);
                    void handleDeleteSourceCollection();
                }}
                onCloseDeleteFolder={() => setIsDeleteFolderOpen(false)}
            />

            {mode === 'tracks' && (
                <GridViewTracksPanel
                    isOpen={showSidePanel}
                    onClose={() => setShowSidePanel(false)}
                    title={collectionName || title}
                    tracks={displayTracks}
                    isDaylight={isDaylight}
                    theme={theme}
                    focusedIndex={listFocusedIndex}
                    revealTimes={locatedTimes}
                    hideTitle={isLocalFolderCollection}
                    supportsTrackSorting={supportsTrackSorting}
                    sorting={sorting}
                    showFloatingButton={displayTracks.length > 0}
                    showLocateButton={playingSongKey !== null && Boolean(collection)}
                    isPlayingSongHere={isPlayingSongHere}
                    isLocateAsked={isLocateAsked}
                    onLocate={locateOnThisPage}
                    onOpenList={() => setShowSidePanel(true)}
                    onPlay={(track) => {
                        onSelectTrack?.(track, playableTracks);
                    }}
                    onAddToQueue={onAddTrackToQueue ? (track) => {
                        onAddTrackToQueue(track);
                    } : undefined}
                    getAlbumTrackLabel={getAlbumTrackLabel}
                />
            )}
        </motion.div>
    );
};

export default GridView;
