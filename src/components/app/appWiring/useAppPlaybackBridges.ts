import type { AppFoundation } from './useAppFoundation';
import type { AppAudioOutput } from './useAppAudioOutput';
import type { AppThemeAndNavigation } from './useAppThemeAndNavigation';
import type { AppAccountsAndStage } from './useAppAccountsAndStage';
import type { AppLibraryControllers } from './useAppLibraryControllers';
import type { AppPlaybackQueue } from './useAppPlaybackQueue';
import { useCapacitorPlaybackBridge } from '../../../hooks/useCapacitorPlaybackBridge';
import { useColorOsLyricFeed } from '../../../hooks/useColorOsLyricFeed';
import { useElectronVideoExportController } from '../../../hooks/useElectronVideoExportController';
import { useImmersiveLyricsBars } from '../../../hooks/useImmersiveLyricsBars';
import { useLyriconFeed } from '../../../hooks/useLyriconFeed';
import { useLyricsWallpaperFeed } from '../../../hooks/useLyricsWallpaperFeed';
import { useMediaSessionBridge } from '../../../hooks/useMediaSessionBridge';
import { useNavidromeScrobbleReporter } from '../../../hooks/useNavidromeScrobbleReporter';
import { useScreenAwake } from '../../../hooks/useScreenAwake';
import { useTranscodeFallback } from '../../../hooks/useTranscodeFallback';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { nativePlaybackEngine } from '../../../services/playbackEngine/nativePlaybackEngine';
import { useNativePlaybackRuntime } from '../../../services/playbackEngine/useNativePlaybackRuntime';
import { currentTime } from '../../../stores/motionSignals';
import { setStatusMessage as setStatusMsg } from '../../../stores/useStatusMessageStore';
import { PlayerState } from '../../../types';
import { resolveLikeAvailability } from '../../../utils/playerLikeAvailability';
import { resolveSongLiked } from '../../../utils/resolveSongLiked';
import { useRecentPlaysRecorder } from '../home/explore/useRecentPlaysRecorder';
import { useElectronPlaybackBridge } from '../playback/bridges/useElectronPlaybackBridge';
import { usePlaybackAudioBridge } from '../playback/bridges/usePlaybackAudioBridge';
import { usePlaybackInteractionBridge } from '../playback/bridges/usePlaybackInteractionBridge';
import { usePlaybackReporter } from '../playback/bridges/usePlaybackReporter';
import { usePlaybackTransportController } from '../playback/bridges/usePlaybackTransportController';
import { usePlaybackVisualizerBridge } from '../playback/bridges/usePlaybackVisualizerBridge';
import { useTransportCommandRefs } from '../playback/bridges/useTransportCommandRefs';
import { useRef, useCallback } from 'react';

// src/components/app/appWiring/useAppPlaybackBridges.ts
// 播放与系统之间的桥：音频分析、转码兜底、transport、系统媒体会话、通知栏、歌词推送。

type Input =
    & AppFoundation
    & AppAudioOutput
    & AppThemeAndNavigation
    & AppAccountsAndStage
    & AppLibraryControllers
    & AppPlaybackQueue;

export const useAppPlaybackBridges = (model: Input) => {
    const {
        analyserRef, animationFrameRef, audioContextRef, audioRef, audioSrc, automix, automixEnabled,
        cachePlayedOutRef, cachedCoverUrl, currentSong, currentView, cyclePlayerChromeVisibilityMode,
        displayCoverUrl, displayPlayerState, displaySong, duration, effectiveLoopMode,
        effectiveLyricTimelineOffsetMs, gainNodeRef, getCoverUrl, getNowPlayingDisplayTime, getPlayerCapDisplayTime,
        getSyntheticStageLyricsTime, getTargetPlaybackVolume, handleLike, handleNextTrack, handlePrevTrack,
        handleStageExternalPlayRequest, handleToggleLoopMode, incomingLyricTimelineOffsetMs, isElectronWindow,
        isLocalSongLiked, isLyricsLoading, isNowPlayingControlDisabledRef, isNowPlayingStageActive,
        isPlayerCapStageActive, likedSongIds, localSongs, lyrics, nativeActive, nativeTakesRef,
        navigateBackFromPlayer, navigateToPlayer, pendingResumeTimeRef, playerChromeVisibilityMode,
        recoverOnlinePlaybackSource, setPlayerChromeVisibilityModeTo, setPlayerState, shouldAutoPlay,
        shouldRefreshCurrentOnlineAudioSource, skipAfterPlaybackFailure, stageActiveEntryKind, stageLyricsClockRef,
        stageLyricsSession, stageStatus, starredNavidromeSongIds, syncNowPlayingClock, syncOutputGain,
        syncStageLyricsClock, t, theme, themeSettling
    } = model;
    const { setupAudioAnalyzer, cacheSongAssets, cacheSongAssetsFor, adoptActiveDeckSource } = usePlaybackAudioBridge({
        audioRef,
        localSongs,
        isLyricsLoading,
        shouldAutoPlayRef: shouldAutoPlay,
        audioContextRef,
        analyserRef,
        gainNodeRef,
        connectDecks: automix.connectDecks,
        getActiveChain: automix.getActiveChain,
        suppressAutoplayRef: automix.suppressAutoplayRef,
        isAutoplayHeld: automix.autoplayHeld,
        syncOutputGain,
        getTargetPlaybackVolume,
        getCoverUrl,
        isTransitionAudible: automix.isTransitionAudible,
    });

    const handleTranscodeFallback = useTranscodeFallback({
        audioSrc,
        localSongs,
        currentTime,
        pendingResumeTimeRef,
        shouldAutoPlayRef: shouldAutoPlay,
        getRecoveryTarget: automix.getRecoveryTarget,
        replaceRecoverySource: automix.replaceRecoverySource,
        clearFailedWarmSource: automix.clearFailedWarmSource,
        abortTransition: automix.abortTransition,
        handleTailEnded: automix.handleTailEnded,
        skipAfterPlaybackFailure,
    });

    // Now the writer exists, point the automix settle path at it. A track that blends out never fires
    // `ended`, so this is the only place its assets get cached; the cover is derived from the exit
    // song's own metadata inside `cacheSongAssetsFor` rather than from the now-arriving track's view.
    cachePlayedOutRef.current = (song, src) => { void cacheSongAssetsFor(song, src); };

    /**
     * The two controls that mean something different while a blend is in flight, held as refs.
     *
     * Both are implemented far below, once automix and playSong exist, and both are needed above
     * that point - the transport controller here, the remote bridge a little further down. A ref
     * plus a stable wrapper is what lets those be wired now and written later without either one
     * re-subscribing every render.
     */
    const seekDuringTransitionRef = useRef<(time: number) => boolean>(() => false);
    const pauseDuringTransitionRef = useRef<() => boolean>(() => false);
    /** Shared by every entry point that can seek while a blend is in flight. */
    const seekDuringTransition = useCallback((time: number) => seekDuringTransitionRef.current(time), []);
    const handlePauseDuringTransition = useCallback(() => pauseDuringTransitionRef.current(), []);

    const { resumePlayback, pausePlayback } = usePlaybackTransportController({
        stageActiveEntryKind,
        isNowPlayingStageActive,
        audioRef,
        audioContextRef,
        stageLyricsClockRef,
        setupAudioAnalyzer,
        syncOutputGain,
        getTargetPlaybackVolume,
        shouldRefreshCurrentOnlineAudioSource,
        recoverOnlinePlaybackSource,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
        pauseDuringTransition: handlePauseDuringTransition,
        isTransitionAudible: automix.isTransitionAudible,
        nativeTakesRef,
    });
    useNavidromeScrobbleReporter({
        audioRef,
        currentSong,
        activeDeck: automix.activeDeck,
    });
    usePlaybackReporter({
        audioRef,
        currentSong,
        activeDeck: automix.activeDeck,
    });
    useRecentPlaysRecorder({
        audioRef,
        currentSong,
        activeDeck: automix.activeDeck,
    });

    const {
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        taskbarHasTrackRef,
        taskbarPlayerStateRef,
    } = useTransportCommandRefs({ resumePlayback, pausePlayback, handlePrevTrack, handleNextTrack });

    useMediaSessionBridge({
        audioRef,
        // All three describe the DISPLAYED track, and that is the whole of the fix: the metadata,
        // the clock the position is read off, and the source the readiness guard compares against.
        // Pairing the displayed song with the ACTIVE deck put the outgoing track's title over the
        // incoming track's duration and progress for the length of every blend - the system panel
        // named one song and counted another. `audioSrc` moves with the element or the guard fails
        // for the whole blend and the panel stops updating instead.
        getDisplayAudioElement: automix.getDisplayElement,
        audioSrc: automix.tailSrc ?? audioSrc,
        currentSong: displaySong,
        cachedCoverUrl: displayCoverUrl ?? cachedCoverUrl,
        playerState: displayPlayerState,
        isNowPlayingStageActive,
        unknownArtistLabel: t('ui.unknownArtist'),
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        isNowPlayingControlDisabledRef,
    });

    // Capacitor Android 专有：把播放状态接到原生前台服务，换通知栏媒体控制，
    // 并让进程拿到前台优先级 —— 否则应用切到后台时 WebView 的 fetch 会被节流挂住，
    // 自动切下一首就拿不到歌曲地址。非 Android 平台直接空转。
    //
    // seekMainAudio 定义在下面（它依赖这批 transport 回调），而通知栏的拖动事件
    // 是异步来的，所以用 ref 接过声明顺序，不把它提前。
    const seekMainAudioRef = useRef<(time: number) => void>(() => { });
    // 通知栏那颗心要的两个值：这首歌现在喜不喜欢、这个动作现在能不能用。
    //
    // 「能不能用」必须和侧边面板同一份判定（resolveLikeAvailability）—— 各平台支不支持
    // 收藏、正由外部 Stage 播放时归谁管，都在那一份里。分头判的话会出现面板置灰、
    // 通知栏却能点，点下去只得到一个「收藏失败」。
    // 「混音过渡中 / 无音源」那一档传 false：它是面板里的一瞬间，通知栏感知不到，
    // 而且它会随下一次元数据推送自己纠正回来。
    const nativeSongLiked = resolveSongLiked(displaySong, { isLocalSongLiked, starredNavidromeSongIds, likedSongIds });
    const nativeCanLikeSong = !resolveLikeAvailability(displaySong, false, isNowPlayingStageActive).disabled;
    useCapacitorPlaybackBridge({
        currentSong: displaySong,
        cachedCoverUrl: displayCoverUrl ?? cachedCoverUrl,
        playerState: displayPlayerState,
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        // 通知栏那条进度条的位置来源。原生播放时必须直接问引擎：后台里 rAF 被停掉，
        // `currentTime` 那个 motion signal 会停在最后一次前台读数上 —— 于是通知栏
        // 显示 00、拖动改完又被下一拍推回 00。
        getCurrentTime: () => (nativeTakesRef.current ? nativePlaybackEngine.getPositionSec() : currentTime.get()),
        onSeek: (seconds) => seekMainAudioRef.current(seconds),
        isLiked: nativeSongLiked,
        canLike: nativeCanLikeSong,
        // 与面板里的喜爱按钮同一个动作：能不能用、状态怎么存都归它，原生不自己记账。
        onToggleLike: handleLike,
    });

    // Capacitor Android 专有：把当前行与行内进度喂给原生歌词动态壁纸。
    // 壁纸是另一个组件，读不到 React 状态，只能由这里主动推过去。
    useLyricsWallpaperFeed({
        lyrics,
        // 原生播放时位置只在播放器手里：`currentTime` 那个 motion signal 由 rAF 写，
        // 后台一藏就被 Chromium 停掉，锚点会冻在最后一次前台读数上。桌面歌词（壁纸 /
        // 悬浮）靠的正是这个锚点，所以取数要原生优先。
        getCurrentTime: () => (nativeTakesRef.current ? nativePlaybackEngine.getPositionSec() : currentTime.get()),
        title: displaySong?.name ?? null,
        artist: displaySong ? getSongArtistLabel(displaySong) : null,
        coverUrl: displayCoverUrl ?? cachedCoverUrl,
        playerState: displayPlayerState,
        duration,
        // 让壁纸沿用 App 当前的主题色、底色与动效强度，避免两套色调各画各的。
        accentColor: theme?.accentColor ?? null,
        backgroundColor: theme?.backgroundColor ?? null,
        // 叠层是另一个 WebView，拿不到 App 的主题对象：主文本色 / 次色也得一并推过去，
        // 否则它只能用内置主题打底，AI 主题换上去颜色一点没变。
        primaryColor: theme?.primaryColor ?? null,
        secondaryColor: theme?.secondaryColor ?? null,
        // 整份主题：AI 主题的 wordColors / lyricsIcons 这类字段一个都传不过去的话，
        // 叠层画出来就只有配色变了，「AI 主题的效果」一点都没有。
        theme,
        // 叠层 / 壁纸那一推要等它落定再发：分两次推（先旧主题、再 AI 主题）就是切歌闪两下。
        themePending: themeSettling,
        animationIntensity: theme?.animationIntensity ?? null,
    });

    // Android 专有：把屏幕钉住不熄。两个开关（界面设置的常驻常亮、播放设置的播放时常亮）
    // 在这里取或后过桥，都默认关。
    useScreenAwake();

    // Android 专有：把当前歌曲与歌词推给状态栏歌词（Lyricon）。
    useLyriconFeed({
        lyrics,
        getCurrentTime: () => (nativeTakesRef.current ? nativePlaybackEngine.getPositionSec() : currentTime.get()),
        title: displaySong?.name ?? null,
        artist: displaySong ? getSongArtistLabel(displaySong) : null,
        // id 在部分音源上是数字，Lyricon 只用它判断换没换歌，统一成字符串即可。
        songId: displaySong?.id == null ? null : String(displaySong.id),
        duration,
        playerState: displayPlayerState,
    });

    // Android 专有：系统栏默认显示，只有可视化歌词页面才隐藏（判定在这里，原生只执行）。
    useImmersiveLyricsBars(currentView);

    // Android 专有 + ColorOS 16+ 专有：把歌词写进 MediaMetadata["lyricInfo"]，
    // 交给系统锁屏 / AOD 歌词页原生渲染。不是那台机器时整条通道不启动（判定在原生侧）。
    useColorOsLyricFeed({
        lyrics,
        song: displaySong,
        duration,
    });

    const {
        exportState,
        handleExportCommand,
    } = useElectronVideoExportController({
        isElectronWindow,
        audioRef,
        navigateToPlayer,
        pausePlayback,
        resumePlayback,
    });

    const {
        publishStagePlayerPlaybackUpdate,
    } = useElectronPlaybackBridge({
        isElectronWindow,
        playerChromeVisibilityMode,
        onRemotePlayerChromeVisibilityModeCycle: cyclePlayerChromeVisibilityMode,
        onRemotePlayerChromeVisibilityModeSet: setPlayerChromeVisibilityModeTo,
        isStagePlayerSnapshotEnabled: stageStatus?.enabled === true,
        isNowPlayingControlDisabledRef,
        audioRef,
        // The deck the held picture belongs to. Its song, lyrics, cover, duration and transport are
        // read from the display selectors inside the bridge; this is the element that goes with them.
        getDisplayAudioElement: automix.getDisplayElement,
        effectiveLoopMode,
        isNowPlayingStageActive,
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
        taskbarHasTrackRef,
        taskbarPlayerStateRef,
        exportState,
        lyricTimelineOffsetMs: effectiveLyricTimelineOffsetMs,
        onRemoteExportCommand: handleExportCommand,
        onExternalPlayRequest: handleStageExternalPlayRequest,
        onRemoteCycleLoopMode: handleToggleLoopMode,
        onRemoteTransitionSeek: seekDuringTransition,
        publishTrackTransition: automixEnabled,
        isTrackTransitionAudible: automix.isTransitionAudible,
        // Keyed on the displayed track, so the like state matches the song the remote is showing
        // while a blend is held rather than the one arriving underneath it.
        isLiked: resolveSongLiked(displaySong, { isLocalSongLiked, starredNavidromeSongIds, likedSongIds }),
        onLike: handleLike,
    });

    usePlaybackVisualizerBridge({
        audioRef,
        analyserRef,
        isTransitionAudible: automix.isTransitionAudible,
        // The loop below is what actually drives the progress bar and the lyric read-head, sixty
        // times a second off whichever deck it is pointed at. Both have to be the held picture's,
        // or the bar and the lyrics run on the incoming track under the outgoing one's title.
        getDisplayElement: automix.getDisplayElement,
        animationFrameRef,
        effectiveLoopMode,
        isNowPlayingStageActive,
        isPlayerCapStageActive,
        stageActiveEntryKind,
        stageLyricsSession,
        stageLyricsClockRef,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
        getNowPlayingDisplayTime,
        getPlayerCapDisplayTime,
        syncNowPlayingClock,
        lyricTimelineOffsetMs: effectiveLyricTimelineOffsetMs,
        incomingLyricTimelineOffsetMs,
    });

    /*
     * 原生播放（P1）的接线。
     *
     * 这里只接「事件 → 状态机」那一半（时长、播完、播不出来）。进度条与歌词的时钟不在这里写：
     * 它们在 usePlaybackVisualizerBridge 的 rAF 里统一从 `nativePlaybackEngine` 读，
     * 两个写手抢同一个 motion signal 只会互相抹掉。
     */
    useNativePlaybackRuntime({
        enabled: nativeActive,
        audioSrc,
        shouldAutoPlayRef: shouldAutoPlay,
        isLyricsLoading,
        getTargetPlaybackVolume,
        repeatOne: effectiveLoopMode === 'one',
        onEnded: () => {
            cacheSongAssets();
            void handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
        },
        onError: () => {
            setStatusMsg(prev => (prev?.persistent ? prev : { type: 'error', text: t('status.playbackError') }));
            setPlayerState(PlayerState.IDLE);
        },
    });

    const {
        togglePlay,
        toggleLoop,
        handleChangeReplayGainMode,
        handleContainerClick,
        handleFmTrash,
    } = usePlaybackInteractionBridge({
        stageActiveEntryKind,
        isNowPlayingStageActive,
        audioRef,
        // Play-vs-pause cannot be decided off the active deck mid-blend: that is the arriving track,
        // and it is silent for the whole lead.
        isTransitionAudible: automix.isTransitionAudible,
        nativeTakesRef,
        // The arrow keys check for a blend first, the way the bar and the remote do, rather than
        // writing to the active deck - which mid-blend is not the deck the listener is watching.
        seekDuringTransition,
        stageLyricsClockRef,
        cyclePlayerChromeVisibilityMode,
        handleNextTrack,
        handlePrevTrack,
        navigateBackFromPlayer,
        pausePlayback,
        resumePlayback,
        syncStageLyricsClock,
    });

    return {
        ...model,
        adoptActiveDeckSource, cacheSongAssets, handleChangeReplayGainMode, handleContainerClick, handleFmTrash,
        handleTranscodeFallback, pauseDuringTransitionRef, pausePlayback, publishStagePlayerPlaybackUpdate,
        resumePlayback, seekDuringTransitionRef, seekMainAudioRef, setupAudioAnalyzer, toggleLoop, togglePlay
    };
};

export type AppPlaybackBridges = ReturnType<typeof useAppPlaybackBridges>;
