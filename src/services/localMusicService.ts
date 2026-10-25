// src/services/localMusicService.ts
// The public API of the local music library. The implementation lives in ./localMusic/, one module
// per part of the library; everything below is re-exported so every caller (and every test) keeps
// importing from here.

export { EMBEDDED_METADATA_VERSION } from './localMusic/songImport';
export { LOCAL_MUSIC_UPDATED_EVENT, LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from './localMusic/libraryEvents';
/**
 * 某一首本地歌的封面**这一刻才抽出来**（detail: `{ songId, assetId }`）。
 *
 * 队列（磁贴墙就是按它铺的）里的条目是**建队列那一刻**把封面烤进 `album.coverUrl` 的
 * （`buildLocalQueue` 按当时的 `localCoverAssetId` 算），而内嵌封面常常是后来才有的：
 * 播放这一首时、预热相邻几首时、列表回填时。没有这一下通知，那些条目就一直带着
 * 「没有封面」的那份快照 —— 于是播放页有封面、磁贴墙一片空白。
 */
/**
 * 见 `services/localCoverReadyEvent`：写在线封面那一侧（`localSongMatchSelectionService`）
 * 也要广播同一个事件，而它不能 import 本模块（会成环），所以常量住在那边。
 */
export { LOCAL_COVER_READY_EVENT } from './localCoverReadyEvent';
// Extract basic metadata from filename.
// Expected format: "Artist - Title.mp3", "Artist-Title.mp3", or "Title.mp3".
// The implementation lives in utils/localSongMetadata so every ingest path shares it; re-exported
// here because callers inside this file (and anything that imported it from here) keep the name.
export { extractMetadataFromFilename } from '../utils/localSongMetadata';
export { clearFolderIgnore, importFolder, resyncAllFolders, resyncFolder } from './localMusic/importFolders';
export { matchLyrics } from './localMusic/lyricsMatch';
export { deleteFolderSongs, deleteLocalSong, deleteSongsByIds, removeImportedRoot } from './localMusic/folderMutations';
export {
    getAudioFromFile,
    getAudioFromLocalSong,
    getFileFromLocalSong,
    getLastLocalAudioFailureReason,
    getLocalSongArrayBuffer,
} from './localMusic/playbackFiles';
export type { LocalAudioFailureReason } from './localMusic/playbackFiles';
export { ensureLocalSongCoverAsset } from './localMusic/covers';
export { renameLocalSong } from './localMusic/renameSong';
export type { LocalSongRenameResult } from './localMusic/renameSong';
