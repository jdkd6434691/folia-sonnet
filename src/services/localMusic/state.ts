import type { LocalSong } from '../../types';

// src/services/localMusic/state.ts
// The in-memory maps the local-music modules share: file handles, cover work in flight, the
// files known to have no embedded cover, and the generation of each removed root.

// In-memory storage for hot-path access. Persistent recovery uses directory handles from IndexedDB.

export const fileHandleMap = new Map<string, FileSystemFileHandle>();
export const localCoverAssetRequestMap = new Map<string, Promise<LocalSong>>();
// 解析过、确认没有内嵌封面的文件：歌曲 id → 当时文件的「大小:修改时间」。没封面时没有可落库的东西，
// 不记下来的话每次播放都要在出声前把文件重新解析一遍。文件被替换后大小或修改时间变了，就会重新解析。
export const songsWithoutEmbeddedCover = new Map<string, string>();

export const removedRootGenerations = new Map<string, number>();
