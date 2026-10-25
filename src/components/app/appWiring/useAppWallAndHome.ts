import type { AppFoundation } from './useAppFoundation';
import type { AppAudioOutput } from './useAppAudioOutput';
import type { AppThemeAndNavigation } from './useAppThemeAndNavigation';
import type { AppAccountsAndStage } from './useAppAccountsAndStage';
import type { AppLibraryControllers } from './useAppLibraryControllers';
import type { AppPlaybackQueue } from './useAppPlaybackQueue';
import type { AppPlaybackBridges } from './useAppPlaybackBridges';
import type { AppChromeAndGestures } from './useAppChromeAndGestures';
import type { AppPublishers } from './useAppPublishers';
import type { AppCommandPalette } from './useAppCommandPalette';
import type { AppPlaybackActions } from './useAppPlaybackActions';
import { setStatusMessage as setStatusMsg } from '../../../stores/useStatusMessageStore';
import { useHomeModel } from '../home/useHomeModel';
import { useAppWallToolsHost } from '../wall-tools/useAppWallToolsHost';

// src/components/app/appWiring/useAppWallAndHome.ts
// 两面墙的工具面板宿主动作与首页模型。

type Input =
    & AppFoundation
    & AppAudioOutput
    & AppThemeAndNavigation
    & AppAccountsAndStage
    & AppLibraryControllers
    & AppPlaybackQueue
    & AppPlaybackBridges
    & AppChromeAndGestures
    & AppPublishers
    & AppCommandPalette
    & AppPlaybackActions;

export const useAppWallAndHome = (model: Input) => {
    const {
        accountController, activeProvider, addNavidromeSongsToQueue, addOnlineSongToQueue, addOnlineSongsToQueue,
        backCollection, clearQueue, cloudPlaylist, commandPalette, focusedPlaylistIndex, handleLocalQueueAdd,
        handlePreviewVolume, isGeneratingTheme, localLibraryCatalog, localMusicState, localPlaylists, localSongs,
        moveQueueSong, moveQueueSongToEnd, moveQueueSongToNext, navidromeFocusedAlbumIndex,
        navigateFromPlayerCapsule, navigateToLattice, navigateToPlayer, navigateToSearch, onRefreshLocalSongs,
        openHomeCollection, openStagePlayer, playOnlineQueueFromStart, playQueue, playSong, playlists,
        popCollectionTo, pushCollection, refreshActiveProviderPlaylists, removeQueueSong,
        saveCurrentQueueAsLocalPlaylist, setFocusedPlaylistIndex, setLocalMusicState, setNavidromeFocusedAlbumIndex,
        stageSource, theme, togglePlay, user
    } = model;
    // 两面墙（bravais 与 Lattice）右下角工具面板的宿主动作：命令面板的同一套命令与队列操作，host 身份稳定。
    const wallToolsHost = useAppWallToolsHost({
        invokeCommandById: commandPalette.invokeCommandById,
        canInvokeCommandById: commandPalette.canInvokeCommandById,
        isGeneratingTheme,
        previewVolume: handlePreviewVolume,
        navigateToPlayer,
        playQueue,
        playSong,
        moveQueueSongToNext,
        moveQueueSongToEnd,
        removeQueueSong,
        moveQueueSong,
        clearQueue,
        saveCurrentQueueAsLocalPlaylist,
    });
    const homeModel = useHomeModel({
        account: accountController,
        activeProvider,
        playSong,
        navigateToPlayer,
        navigateToLattice,
        togglePlayback: togglePlay,
        enterPlaybackView: navigateFromPlayerCapsule,
        refreshOnlineProviderPlaylists: refreshActiveProviderPlaylists,
        user,
        playlists,
        cloudPlaylist,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        navigateToSearch,
        localSongs,
        localLibraryCatalog,
        localPlaylists,
        onRefreshLocalSongs,
        onAddLocalSongToQueue: handleLocalQueueAdd,
        localMusicState,
        setLocalMusicState,
        onAddNavidromeSongsToQueue: addNavidromeSongsToQueue,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        stageSource,
        openStagePlayer,
        theme,
        playAll: playOnlineQueueFromStart,
        addAllToQueue: addOnlineSongsToQueue,
        addSongToQueue: addOnlineSongToQueue,
        onStatusMessage: setStatusMsg,
        onOpenCollection: openHomeCollection,
        onPushCollection: pushCollection,
        onPopCollectionTo: popCollectionTo,
        onBackCollection: backCollection,
    });

    return {
        ...model,
        homeModel, wallToolsHost
    };
};

export type AppWallAndHome = ReturnType<typeof useAppWallAndHome>;
