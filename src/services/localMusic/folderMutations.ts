import type { LocalSong } from '../../types';
import { removeCachedCover } from '../coverCache';
import { deleteDirHandle, deleteLocalSong as dbDeleteLocalSong, deleteLocalSongs as dbDeleteLocalSongs, getLocalSongs } from '../db';
import { markLocalRootRemoved, normalizeLocalFolderPath, runLocalFolderMutation, setLocalFolderIgnored } from '../localLibraryFolderIgnore';
import { getLocalPlaylists, saveLocalPlaylists } from '../localPlaylistService';
import { deleteAndroidImportedAudio } from '../nativeLocalMusic';
import { cleanupDirHandleIfUnused } from './fileHandles';
import { getRootFolderName, songBelongsToRootFolder } from './folderPaths';
import { notifyLocalMusicUpdated } from './libraryEvents';
import { fileHandleMap, localCoverAssetRequestMap, removedRootGenerations, songsWithoutEmbeddedCover } from './state';

// src/services/localMusic/folderMutations.ts
// Removing local songs, folders and imported roots from the app, without touching the files on disk.

async function removeDeletedSongIdsFromPlaylists(songIds: string[]): Promise<void> {
    if (songIds.length === 0) {
        return;
    }

    const removingIds = new Set(songIds);
    const playlists = await getLocalPlaylists();
    let changed = false;
    const nextPlaylists = playlists.map(playlist => {
        const nextSongIds = playlist.songIds.filter(songId => !removingIds.has(songId));
        if (nextSongIds.length === playlist.songIds.length) {
            return playlist;
        }

        changed = true;
        return {
            ...playlist,
            songIds: nextSongIds,
        };
    });

    if (changed) {
        await saveLocalPlaylists(nextPlaylists);
    }
}

// Delete local song
export async function deleteLocalSong(id: string): Promise<void> {
    // Remove fileHandle from memory
    fileHandleMap.delete(id);
    await Promise.all([
        dbDeleteLocalSong(id),
        removeCachedCover(`cover_local_${id}`),
    ]);
}

// Delete songs by their specific IDs
export async function deleteSongsByIds(songIds: string[]): Promise<void> {
    const uniqueSongIds = Array.from(new Set(songIds));
    if (uniqueSongIds.length === 0) return;
    const allSongs = await getLocalSongs();
    const deletedIdSet = new Set(uniqueSongIds);
    const deletedSongs = allSongs.filter(song => deletedIdSet.has(song.id));
    const affectedRoots = new Set(
        deletedSongs
            .map(getRootFolderName)
            .filter((root): root is string => Boolean(root)),
    );
    // 安卓「挑选导入」的音频是复制进 App 私有目录的：库里删了，那份副本也得跟着删，
    // 否则它会一直留着占空间（只清自己写出的 imported-*，MediaStore 的歌是引用不删）。
    void deleteAndroidImportedAudio(
        deletedSongs
            .map(song => song.nativeAudioRef)
            .filter((ref): ref is string => Boolean(ref)),
    ).catch(error => console.warn('[LocalMusic] Failed to delete imported android audio:', error));
    uniqueSongIds.forEach(id => {
        fileHandleMap.delete(id);
        localCoverAssetRequestMap.delete(id);
        songsWithoutEmbeddedCover.delete(id);
    });
    await Promise.all([
        dbDeleteLocalSongs(uniqueSongIds),
        ...uniqueSongIds.map(id => removeCachedCover(`cover_local_${id}`)),
    ]);
    await removeDeletedSongIdsFromPlaylists(uniqueSongIds);
    await Promise.all(Array.from(affectedRoots).map(cleanupDirHandleIfUnused));
    notifyLocalMusicUpdated();
    console.log(`[LocalMusic] Deleted ${uniqueSongIds.length} songs by ID`);
}

// Removes an imported root from the app, including empty roots, without deleting disk files.
export function removeImportedRoot(rootFolderName: string): Promise<void> {
    return runLocalFolderMutation(() => removeImportedRootContents(rootFolderName));
}

async function removeImportedRootContents(rootFolderName: string): Promise<void> {
    const normalizedRoot = normalizeLocalFolderPath(rootFolderName).split('/')[0];
    if (!normalizedRoot) return;
    removedRootGenerations.set(normalizedRoot, (removedRootGenerations.get(normalizedRoot) || 0) + 1);

    const allSongs = await getLocalSongs();
    const songIds = allSongs
        .filter(song => songBelongsToRootFolder(song, normalizedRoot))
        .map(song => song.id);

    if (songIds.length > 0) {
        await deleteSongsByIds(songIds);
    }
    await Promise.all([
        deleteDirHandle(normalizedRoot),
        // 原来是 deleteLocalLibrarySnapshot：那样只把快照抹掉，而安卓上「刷新」等于整库重扫，
        // 歌一首不少地回来 —— 删了跟没删一样。改成留一条墓碑，刷新那条路照它跳过。
        markLocalRootRemoved(normalizedRoot),
    ]);
    notifyLocalMusicUpdated();
}

// Delete all songs from a specific folder (and its nested children)
export function deleteFolderSongs(folderName: string): Promise<void> {
    return runLocalFolderMutation(() => deleteFolderContents(folderName));
}

async function deleteFolderContents(folderName: string): Promise<void> {
    folderName = normalizeLocalFolderPath(folderName);
    if (!folderName.includes('/')) return removeImportedRootContents(folderName);
    await setLocalFolderIgnored(folderName, true);
    // Get all local songs
    const allSongs = await getLocalSongs();

    // Filter songs that belong to this folder OR are nested under it
    const songsToDelete = allSongs.filter(song =>
        song.folderName === folderName || (song.folderName && song.folderName.startsWith(`${folderName}/`))
    );

    const songIdsToDelete = songsToDelete.map(song => song.id);
    songIdsToDelete.forEach(id => {
        fileHandleMap.delete(id);
        localCoverAssetRequestMap.delete(id);
        songsWithoutEmbeddedCover.delete(id);
    });
    await Promise.all([
        dbDeleteLocalSongs(songIdsToDelete),
        ...songIdsToDelete.map(id => removeCachedCover(`cover_local_${id}`)),
    ]);
    await removeDeletedSongIdsFromPlaylists(songIdsToDelete);

    notifyLocalMusicUpdated();
    console.log(`[LocalMusic] Deleted ${songsToDelete.length} songs from folder tree: ${folderName}`);
}
