import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useDragControls, useIsPresent } from 'framer-motion';
import { ChevronLeft, ListPlus, RefreshCw } from 'lucide-react';
import GridPanelToggleIndicator from '../shared/GridPanelToggleIndicator';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme } from '../../../../types';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import { getSongCoverUrl } from '../../../../services/onlineMusic/songMetadata';
import type { LibraryArtistResource } from '../../../core/artist/artist.contract';
import type { LibraryPlaybackPort } from '../../../core/shared/ports.contract';
import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import { useArtistResourceState } from '../../../core/artist/useArtistResourceState';
import { useArtistView } from '../../../core/artist/useArtistView';
import { useLibraryArtistSurfaceRegistration } from '../../../core/artist/useLibraryArtistSurfaceRegistration';
import {
    artistAlbumCoverUrl,
    artistAlbumLink,
    toHttpsCoverUrl,
} from '../../../core/artist/artistModel';
import { useGridStayPlayback } from '../shared/useGridStayPlayback';
import ActiveGridMarker from '../shared/ActiveGridMarker';
import {
    collectionMorphEntranceTravel,
    type CollectionMorphPlan,
} from '../transitions/morphGeometry';
import { useCollectionMorphStore, useMorphPageExit } from '../transitions/collectionMorphStore';
import { useGridViewSettingsStore } from '../../../../stores/useGridViewSettingsStore';
import { CollectionListItem, SidePanelList } from '../../../../components/shared/SidePanelList';
import { GridListSearchButton } from '../../../../components/shared/GridListSearchButton';
import { useGridCommandFilter } from '../../../../hooks/useGridCommandFilter';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { closeCommandFilter } from '../../../../stores/useAppViewStore';
import { deriveProgressiveLoadingState } from '../shared/progressiveGrid';
import { useProgressiveItemEntrance } from '../shared/useProgressiveItemEntrance';
import { Button } from '../../../../components/ui';
import { ArtistGridInfoCutInPanel } from './ArtistGridInfoCutInPanel';
import { ArtistGridCards } from './ArtistGridCards';
import { useArtistGridCamera } from './useArtistGridCamera';
import { useArtistGridShortcuts } from './useArtistGridShortcuts';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { COMES_UP_FOR_MS, PICTURE_ONLY, getLowResCoverUrl } from './artistGridLayout';
import type { GridItem } from './artistGridLayout';

// 对外导出保持兼容（gridLayout 与 test/unit/gridView/progressiveGrid 仍从本文件引）。
export { artistGridStateStorageKey, buildArtistGridCoords } from './artistGridLayout';

/*
 * ArtistGridView.tsx
 *
 * This file implements the new Grid view style for the Artist profile.
 * It uses an infinite draggable and zoomable canvas representing the artist details.
 * Specifically, the artist avatar and editorial newspaper biography card are placed at custom central grid coordinates,
 * while popular tracks and albums are automatically distributed in the nearest and outer hexagonal cells.
 *
 * P4.1 起数据来自宿主持有的歌手资源（core/artist/artistResource.service，经 useArtistResourceState 订阅）：
 * 详情、热门歌曲、专辑与专辑的后台分页、失败与重试都在资源里；这里只负责展示与交互。
 *
 * P4.2 起筛选词与「看到哪一项」（条目键：song:… / album:…）在浏览会话里（core/artist/useArtistView），
 * 换 suite 不丢；这里另存的 sessionStorage 记录只放网格自己的布局（相机位置与焦点卡的下标），键带版本与完整的
 * collectionKey（folia_artist_grid_state:v2:<key>），旧版只按来源与 id 存的记录不再读取。
 * 动作的能力来自 core（声明 ∩ 能力），并作为 artist surface 发布到命令面板。
 */

interface ArtistGridViewProps {
    collection: any; // GridViewCollectionDescriptor
    /** 宿主持有的歌手资源（没有时按加载中处理）。 */
    resource: LibraryArtistResource | null;
    /** 播放端口：单曲播放 / 入队、播放全部与静默整批入队（「加入热门歌曲」）。 */
    playback: LibraryPlaybackPort;
    /** 网格在歌手页上声明的动作（entry.ts）；入口与命令面板只给「声明 ∩ core 能力」。 */
    declaredActions: LibraryDeclaredActions;
    onBack: () => void;
    /** 返回按钮：看完了（宿主清会话与布局记录再返回）。 */
    onDone: () => void;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    theme: Theme;
    isDaylight: boolean;
    onEditEntity?: (entityId: string) => void;
    isInteractive?: boolean;
    /**
     * Optional「移形换影」plan (the grid's surface reads it, useGridMorphPlan): every song/album
     * card settles in from a short push in a distance-staggered cascade, and
     * `kind: 'morph'` additionally means a cover is flying to the round
     * picture, so the bio card beside it fades in meanwhile (with a plain
     * 'cascade' it is simply there). Absent for every other caller, so
     * behavior is unchanged.
     */
    morphPlan?: CollectionMorphPlan | null;
}

const ArtistGridView: React.FC<ArtistGridViewProps> = ({
    collection,
    resource,
    playback,
    declaredActions,
    onBack,
    onDone,
    onSelectAlbum,
    onSelectArtist,
    theme,
    isDaylight,
    onEditEntity,
    isInteractive = true,
    morphPlan = null,
}) => {
    const { t } = useTranslation();
    // The artist wall renders the same cards as GridView, so it follows the same look settings.
    const fullBleedCover = useGridViewSettingsStore(state => state.gridViewFullBleedCover);
    const squareCards = useGridViewSettingsStore(state => state.gridViewSquareCards) && fullBleedCover;
    const minCardScale = useGridViewSettingsStore(state => state.gridViewMinCardScale);
    const minCardOpacity = useGridViewSettingsStore(state => state.gridViewMinCardOpacity);
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';
    const cardBg = isDaylight ? 'bg-white/60 border border-white/30' : 'bg-zinc-900/60 border border-white/10';

    const pageExit = useMorphPageExit();
    // 退场动画期间旧歌手页仍挂着：只有在场的那一个接筛选框与命令面板。
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    const dragControls = useDragControls();
    const isDraggingRef = useRef(false);

    // 歌手数据：宿主的歌手资源。专辑的后台分页在拖拽中先暂存，松手后提交（与集合网格同一道门）。
    const { snapshot, flushHeld } = useArtistResourceState(resource, { holdBackground: () => isDraggingRef.current });
    // fb3：「留在原处」时热门歌曲卡片上正在播放的那首切换暂停 / 继续（与集合网格同一个规则，见 useGridStayPlayback）。
    const stayPlayback = useGridStayPlayback(playback.playTrack, playback);
    const stayPort = useMemo<LibraryPlaybackPort>(
        () => ({ ...playback, playTrack: stayPlayback.selectTrack }),
        [playback, stayPlayback.selectTrack],
    );
    // 筛选词、专辑筛选、能力与动作：与 TUI 歌手页同一份 core 绑定。
    const artistView = useArtistView({
        collection,
        resource,
        snapshot,
        playback: stayPort,
        declaredActions,
        onEditEntity,
        onOpenAlbum: onSelectAlbum,
        setStatus: setStatusMessage,
    });
    const { sessionKey, offers, actions: artistActions, capabilities } = artistView;

    const [showFullBio, setShowFullBio] = useState(false);
    const [showSidePanel, setShowSidePanel] = useState(false);
    const [showCutInPanel, setShowCutInPanel] = useState(false);
    // 筛选词在浏览会话里（换 suite 不丢）；会话里已有筛选时首次可交互就把筛选框带出来。
    const searchQuery = artistView.query;
    const setSearchQuery = artistView.setQuery;
    // The filter box is the command palette now; this grid only says who owns typing and where the
    // box belongs. See useGridCommandFilter for why all three grids stopped carrying their own.
    const rootRef = useRef<HTMLDivElement>(null);
    const isFiltering = useGridCommandFilter({
        isInteractive: isActive,
        port: artistView.queryPort,
        // The box was positioned against this component's root, not the drag canvas.
        anchorRef: rootRef,
        reopenIfFiltered: true,
    });
    // 命令面板的歌手页动作（播放 / 入队热门歌曲、重新加载、续专辑、编辑本地歌手）：声明 ∩ core 能力。
    useLibraryArtistSurfaceRegistration({
        isInteractive: isActive,
        getState: artistView.surfaceState,
        run: artistView.runSurface,
    });

    const artistInfo = snapshot?.detail ?? null;
    const topSongs = artistView.topSongs;
    const status = snapshot?.status ?? 'idle';
    const loading = status === 'idle' || status === 'loading';
    const albumSync = snapshot?.albumSync;
    // 被暂停的分页（资源刚被复用、ensure 马上会续上）按「还在加载」显示。
    const backgroundLoading = albumSync?.state === 'syncing'
        || (albumSync?.state === 'interrupted' && albumSync.reason === 'paused');
    const backgroundLoadFailed = albumSync?.state === 'interrupted' && albumSync.reason === 'failed';
    const loadError = status === 'error' ? snapshot?.error ?? 'load-failed' : null;

    // The page is coming up from its first render until a little after `loading` has ended. For
    // an online artist that is when the artist and the top songs are in (the albums still come in
    // pages); for a Navidrome or a local artist it is the end of the whole read.
    const [isComingUp, setIsComingUp] = useState(true);
    useEffect(() => {
        if (loading || !isComingUp) return;
        const timer = setTimeout(() => setIsComingUp(false), COMES_UP_FOR_MS);
        return () => clearTimeout(timer);
    }, [loading, isComingUp]);
    // Until the artist has been read nothing but the round picture is on the page, and the wheel
    // and the arrow keys do not move the camera from under it: a cover may be flying to where it
    // stands.
    const hasArtist = Boolean(artistInfo);

    const filteredAlbums = artistView.shownAlbums;

    // 专辑卡带着打开专辑时交给宿主的链接提示（来源与 provider 取自歌手页，见 artistAlbumLink）。
    const albumGridItems = useMemo<GridItem[]>(() => filteredAlbums.map((album) => ({
        id: album.id,
        name: album.name,
        coverUrl: artistAlbumCoverUrl(album),
        description: album.publishedAt ? new Date(album.publishedAt).getFullYear().toString() : '',
        rawCollection: artistAlbumLink(album, collection),
    })), [collection, filteredAlbums]);

    // Mapping items:
    // Index 0: Avatar
    // Index 1: Bio
    // Index 2..11: Songs
    // Index 12..: Albums
    const gridItems = useMemo<GridItem[]>(() => {
        // A read that has ended without an artist leaves the page empty.
        if (!artistInfo && !loading) return [];

        const itemsList: GridItem[] = [];

        // 1. Avatar Item (No text info, pure image display). On the page from its first render,
        // before the artist has been read: a cover that flies to the page lands on it, and where
        // it lands is measured in the commit that mounts the page. The rest comes with the artist.
        itemsList.push({
            id: '__artist_avatar__',
            name: '',
            coverUrl: artistInfo?.coverUrl,
        });
        if (!artistInfo) return itemsList;

        // 2. Bio Card
        itemsList.push({
            id: '__artist_bio__',
            name: artistInfo.name,
            coverUrl: artistInfo.coverUrl,
            description: artistInfo.description,
            subtitle: artistInfo.aliases?.[0] || '',
        });

        // 3. Popular Songs
        topSongs.forEach((song, idx) => {
            itemsList.push({
                id: song.id,
                name: song.name,
                coverUrl: getSongCoverUrl(song),
                subtitle: String(idx + 1),
                description: song.artists?.map(a => a.name).join('/') || '',
                rawTrack: song,
                rawTrackIndex: idx,
            });
        });

        // 4. Albums
        itemsList.push(...albumGridItems);

        return itemsList;
    }, [albumGridItems, artistInfo, loading, topSongs]);
    // Queue context for track selection: unavailable tracks are excluded so playback matches the playlist/album
    // surfaces (useArtistView's playSong uses the playable top songs as the queue).
    const canPlaySong = offers('play');
    const canEnqueueSong = offers('enqueue');
    const canOpenAlbum = offers('open-album');
    const handleSelectArtist = offers('open-artist') ? onSelectArtist : undefined;
    const handleSelectAlbumLink = offers('open-album') ? onSelectAlbum : undefined;
    const shouldAnimateItemEntrance = useProgressiveItemEntrance(
        `${String(collection.source)}:${String(collection.id)}`
    );

    const {
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
    } = useArtistGridCamera({
        sessionKey,
        gridItems,
        topSongCount: topSongs.length,
        albumCount: albumGridItems.length,
        artistInfo,
        squareCards,
        minCardScale,
        minCardOpacity,
    });

    useArtistGridShortcuts({
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
    });

    const backgroundCoverUrl = getSongCoverUrl(topSongs[0]) || '';

    // 「移形换影」artist-page entrance: the round picture stands at its place
    // from the page's first render, before the artist has been read (a cover
    // flying to the page lands on it; the overlay hides and shows it). The bio
    // card fades in beside it when the artist has been read; every song/album
    // card settles in along its radial from the picture — the same
    // distance-staggered cascade as GridView's.
    //
    // The plan lasts as long as the flight, and the artist may be read after
    // the cover has landed: the entrance is the plan there is now, else, for as
    // long as the page is coming up, the plan the page was opened with.
    const [openedWith] = useState(morphPlan);
    const entrance = morphPlan ?? (isComingUp ? openedWith : null);
    // With reduced motion there is no plan, and the biography card and the picture do not
    // come in either (the cards' own short fade is as it was).
    const reducedMotion = useReducedMotionFor('collectionMorph');
    // A page mounted while a flight back is armed is one that is come back to (an album opened
    // from it is left). It is not where that flight lands: the cover that flies back is the
    // album's, and it goes where it is. The round picture of such a page is a landing place once
    // its artist has been read, as it was before the picture stood on the page from the first
    // render. A back that armed no flight (through the history) is not known by this; such a
    // page is given no plan (the plan there may be is the album's), so its picture is the
    // entry's until its artist has been read.
    const [isComeBackTo] = useState(() => useCollectionMorphStore.getState().exit !== null);
    const isLandingPlace = !isComeBackTo || hasArtist;
    const morphFlyInReach = useMemo(() => (
        entrance ? collectionMorphEntranceTravel(containerSize) : 0
    ), [entrance, containerSize]);
    // What the round picture shows. Once the artist has been read: the artist's own picture, else
    // the one the entry that opened the page came with. Until then: the cover that flew here,
    // else (none flew, or the page is come back to) the entry's.
    const entryPicture = collection.coverUrl ? getSizedCoverUrl(collection.coverUrl, 512) : null;
    const artistPicture = artistInfo
        ? (artistInfo.coverUrl ? getSizedCoverUrl(artistInfo.coverUrl, 512) : entryPicture)
        : ((!isComeBackTo && openedWith?.kind === 'morph' && openedWith.coverUrl) || entryPicture);
    // The viewport says which cards to draw from an effect, a render or two after the page's
    // first. The round picture is drawn from the first.
    const drawnIndexes = renderedIndexes.length > 0 ? renderedIndexes : PICTURE_ONLY;

    const progressiveLoading = deriveProgressiveLoadingState(
        gridItems.length,
        loading,
        backgroundLoading
    );

    return (
        <motion.div
            ref={rootRef}
            data-ponder-page-scope="grid-view-page"
            data-library-renderer="grid"
            data-library-surface="artist"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={pageExit}
            className="fixed inset-0 z-50 flex flex-col font-sans select-none overflow-hidden"
            style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-color)' }}
        >
            {/* 「我是当前这层网格」的标记，放在根节点里：移形换影的测量只在这个子树里找落点，
                否则正在退出的上一层网格会被当成目标。订阅关在子组件里，见 ActiveGridMarker。 */}
            <ActiveGridMarker />

            {backgroundCoverUrl && (
                <div
                    className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
                    style={{ opacity: isDaylight ? 0.18 : 0.12 }}
                >
                    <img
                        src={toHttpsCoverUrl(getLowResCoverUrl(backgroundCoverUrl))}
                        alt=""
                        className="w-full h-full object-cover scale-110 filter blur-[30px]"
                    />
                </div>
            )}

            {/* Header Area */}
            <div
                data-folia-artistgrid-header="true"
                className="absolute top-0 left-0 p-6 z-30 flex items-center gap-4"
            >
                <Button
                    // 返回按钮表示看完了（onDone）：宿主清掉浏览会话、让每套 suite 忘掉布局记录，再返回
                    // （Escape 与浏览器后退保留）。P4.5 起这条语义在宿主，不在这里清。
                    onClick={onDone}
                    tip={t('ui.back')}
                    className={`w-10 h-10 rounded-full ${closeBtnBg} flex items-center justify-center transition-colors backdrop-blur-md cursor-pointer`}
                    style={{ color: 'var(--text-primary)' }}
                >
                    <ChevronLeft size={20} />
                </Button>
                {offers('enqueue-scope') && (
                    <Button
                        type="button"
                        onClick={() => artistActions.enqueueScope()}
                        disabled={!capabilities['enqueue-scope'].enabled}
                        className={`h-10 w-10 sm:w-auto sm:px-4 rounded-full ${closeBtnBg} flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors backdrop-blur-md cursor-pointer disabled:opacity-40 disabled:cursor-default`}
                        style={{ color: 'var(--text-primary)' }}
                        title={t('artistGrid.addTopSongsToQueue')}
                        aria-label={t('artistGrid.addTopSongsToQueue')}
                    >
                        <ListPlus size={16} />
                        <span className="hidden sm:inline">{t('artistGrid.addTopSongsToQueue')}</span>
                    </Button>
                )}
            </div>

            {/* Title display inside viewport header */}
            <div
                onClick={() => {
                    closeCommandFilter();
                    setShowSidePanel(false);
                    setShowCutInPanel(current => !current);
                }}
                /* 安全区：居中标题，`absolute top-5` —— CSS 用 margin-top 往下让（见 androidPhoneFit.css ⑥）。 */
                data-folia-safe-top="shift"
                className="group/grid-title absolute left-1/2 top-5 -translate-x-1/2 z-[70] text-center flex flex-col items-center select-none cursor-pointer hover:scale-[1.01] active:scale-98 transition-all px-5 py-2 rounded-2xl backdrop-blur-md"
                style={{
                    backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                    color: 'var(--text-primary)',
                }}
            >
                <Button
                    type="button"
                    className="flex items-center gap-1.5 text-lg font-bold tracking-tight cursor-pointer"
                    aria-expanded={showCutInPanel}
                >
                    {artistInfo?.name || collection.name}
                    <GridPanelToggleIndicator isOpen={showCutInPanel} />
                </Button>
                <p className="text-xs opacity-50 mt-0.5">{t('navidrome.artists') || 'Artists'}</p>
            </div>

            <ArtistGridInfoCutInPanel
                isOpen={showCutInPanel}
                artistName={artistInfo?.name || collection.name}
                coverUrl={artistInfo?.coverUrl}
                description={artistInfo?.description}
                trackCount={artistInfo?.trackCount}
                albumCount={artistInfo?.albumCount}
                entityId={collection.source === 'local' ? collection.entityId : undefined}
                onClose={() => setShowCutInPanel(false)}
                onEditEntity={offers('edit-entity') ? () => {
                    setShowCutInPanel(false);
                    artistActions.editEntity();
                } : undefined}
            />

            {(progressiveLoading.backgroundLoading || backgroundLoadFailed || loadError) && (
                <Button
                    type="button"
                    onClick={() => {
                        // 加载失败：从头重新加载；专辑分页失败：从失败的那一页续（详情与热门歌曲不重新请求）。
                        if (loadError) artistActions.reload();
                        else if (backgroundLoadFailed) artistActions.retryAlbums();
                    }}
                    className="absolute right-6 top-5 z-[70] flex items-center gap-2 rounded-full px-3 py-2 text-xs backdrop-blur-md"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg-color) 65%, transparent)' }}
                    title={t('playlist.loading')}
                >
                    <RefreshCw size={14} className={progressiveLoading.backgroundLoading ? 'animate-spin' : ''} />
                    {backgroundLoadFailed || loadError ? t('ui.retry') : t('playlist.loading')}
                </Button>
            )}

            {/* Draggable Viewport Canvas */}
            <div
                ref={containerRef}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    const target = event.target as HTMLElement;
                    if (target.closest('button, input, a, textarea')) return;
                    dragControls.start(event);
                }}
                className="w-full flex-1 relative z-10 flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden"
                style={{ touchAction: 'none' }}
            >
                {loadError && gridItems.length === 0 ? (
                    // 失败用集合页同一句文案（「加载失败：…」），重试在右上角的按钮上。
                    <div className="opacity-40 text-sm">
                        {t('playlist.loadFailed', {
                            error: loadError === 'source-unavailable' ? t('search.sourceNavidrome') : (collection.name || ''),
                        })}
                    </div>
                ) : gridItems.length === 0 ? (
                    <div className="opacity-40 text-sm">{t('home.loadingLibrary') || 'No items found'}</div>
                ) : (
                    <motion.div
                        drag
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={dragBounds}
                        dragElastic={0.05}
                        dragTransition={{ power: 0.16, timeConstant: 220 }}
                        onDragStart={() => {
                            isDraggingRef.current = true;
                        }}
                        onDragEnd={() => {
                            setTimeout(() => {
                                isDraggingRef.current = false;
                                // 拖拽期间暂存的专辑分页现在提交。
                                flushHeld();
                            }, 50);
                        }}
                        style={{ x: dragX, y: dragY, background: 'rgba(0,0,0,0)', touchAction: 'none' }}
                        className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing bg-transparent"
                    >
                        {/* Spatial visual separator texts anchored around the artist avatar. */}
                        <div
                            className="absolute text-2xl md:text-3xl font-extrabold tracking-[0.25em] select-none pointer-events-none opacity-[0.06] transition-opacity duration-300 font-serif"
                            style={{
                                transform: `translate(-50%, -50%) translate(${-(layoutConfig.spacingX * 2.55)}px, ${-(layoutConfig.spacingY * 0.42)}px)`,
                                color: 'var(--text-primary)',
                                left: '50%',
                                top: '50%',
                                whiteSpace: 'nowrap',
                                zIndex: 80,
                            }}
                        >
                            {t('artistGrid.popularSongs')}
                        </div>
                        <div
                            className="absolute text-2xl md:text-3xl font-extrabold tracking-[0.25em] select-none pointer-events-none opacity-[0.06] transition-opacity duration-300 font-serif"
                            style={{
                                transform: `translate(-50%, -50%) translate(${layoutConfig.spacingX * 0.45}px, ${layoutConfig.spacingY * 0.52}px)`,
                                color: 'var(--text-primary)',
                                left: '50%',
                                top: '50%',
                                whiteSpace: 'nowrap',
                                zIndex: 80,
                            }}
                        >
                            {t('artistGrid.artistAlbums')}
                        </div>

                        <ArtistGridCards
                            drawnIndexes={drawnIndexes}
                            gridItems={gridItems}
                            baseCoords={baseCoords}
                            layoutConfig={layoutConfig}
                            clipRadius={clipRadius}
                            minCardScale={minCardScale}
                            minCardOpacity={minCardOpacity}
                            isDaylight={isDaylight}
                            theme={theme}
                            fullBleedCover={fullBleedCover}
                            focusedIndex={focusedIndex}
                            artistInfo={artistInfo}
                            artistActions={artistActions}
                            markFor={stayPlayback.markFor}
                            canPlaySong={canPlaySong}
                            canEnqueueSong={canEnqueueSong}
                            canOpenAlbum={canOpenAlbum}
                            onSelectAlbum={onSelectAlbum}
                            handleSelectArtist={handleSelectArtist}
                            handleSelectAlbumLink={handleSelectAlbumLink}
                            persistNavigationState={persistNavigationState}
                            shouldAnimateItemEntrance={shouldAnimateItemEntrance}
                            entrance={entrance}
                            isComingUp={isComingUp}
                            reducedMotion={reducedMotion}
                            artistPicture={artistPicture}
                            isLandingPlace={isLandingPlace}
                            morphFlyInReach={morphFlyInReach}
                            dragX={dragX}
                            dragY={dragY}
                            centerOnIndex={centerOnIndex}
                            isDraggingRef={isDraggingRef}
                            setShowFullBio={setShowFullBio}
                            cardWrapperRefs={cardWrapperRefs}
                            cardBg={cardBg}
                        />
                    </motion.div>
                )}
            </div>

            {albumGridItems.length > 0 && (
                <GridListSearchButton
                    isDaylight={isDaylight}
                    accentColor={theme.accentColor}
                    listTitle={t('artistGrid.viewAlbums')}
                    searchTitle={t('artistGrid.searchAlbums')}
                    onOpenList={() => setShowSidePanel(true)}
                />
            )}

            <SidePanelList
                isOpen={showSidePanel}
                onClose={() => setShowSidePanel(false)}
                title={t('artistGrid.artistAlbums')}
                items={albumGridItems}
                itemHeight={60}
                isDaylight={isDaylight}
                focusedIndex={Math.max(0, focusedIndex - 2 - topSongs.length)}
                renderItem={(item, index, style) => (
                    <CollectionListItem
                        key={`${item.id}-${index}`}
                        item={item}
                        index={index}
                        style={style}
                        isActive={focusedIndex === 2 + topSongs.length + index}
                        onClick={() => {
                            const gridIndex = 2 + topSongs.length + index;
                            centerOnIndex(gridIndex, true);
                            setShowSidePanel(false);
                            window.setTimeout(() => {
                                if (item.rawCollection && canOpenAlbum) {
                                    persistNavigationState(gridIndex);
                                    onSelectAlbum?.(item.rawCollection.id, item.rawCollection);
                                }
                            }, 320);
                        }}
                    />
                )}
            />

            {/* Biography Full Text Modal */}
            <AnimatePresence>
                {showFullBio && artistInfo?.description && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowFullBio(false)}
                        className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-2xl p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 15 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 15 }}
                            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                            onClick={(e) => e.stopPropagation()}
                            className={`max-w-xl w-full max-h-[70vh] rounded-3xl p-8 flex flex-col shadow-2xl text-left relative overflow-hidden ${cardBg}`}
                        >
                            <Button
                                onClick={() => setShowFullBio(false)}
                                className="absolute top-6 right-6 opacity-40 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors cursor-pointer"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                ✕
                            </Button>

                            <div className="mb-4">
                                <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">Biography</span>
                                <h3 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
                                    {artistInfo.name}
                                </h3>
                                {artistInfo.aliases?.[0] && (
                                    <p className="text-xs opacity-50 mt-0.5">{artistInfo.aliases[0]}</p>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 leading-relaxed text-sm opacity-80 break-words whitespace-pre-wrap">
                                {artistInfo.description}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ArtistGridView;
