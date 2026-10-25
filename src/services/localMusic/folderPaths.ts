import type { LocalSong } from '../../types';

// src/services/localMusic/folderPaths.ts
// Which imported root a song belongs to: by its logical folder name, or by the path it came from.

export function getRootFolderName(song: LocalSong): string | null {
    const pathLike = song.filePath || song.folderName;
    if (!pathLike) return null;

    const [rootFolderName] = pathLike.split('/');
    return rootFolderName || null;
}

/**
 * 这首歌属不属于这个根目录。
 *
 * 不能只按 `getRootFolderName` 判：那个函数先看 `filePath`，而安卓上 filePath 是
 * `Android/MediaStore/<id>` 这种伪路径 —— 推出来的根是 "Android"，可目录卡片上的名字
 * 是 "Android 本地音乐"。一头一尾对不上，于是「删除文件夹」一首歌都没匹配到：
 * 点了删除，目录原封不动，用户看到的就是「删不掉」。
 *
 * 所以两个来源都认：逻辑目录 folderName（一定带根目录名）命中，或者 filePath 推出来的
 * 根命中。
 */
export function songBelongsToRootFolder(song: LocalSong, rootFolderName: string): boolean {
    if (song.folderName === rootFolderName) return true;
    if (song.folderName?.startsWith(`${rootFolderName}/`)) return true;
    return getLocalSongRootFolderName(song) === rootFolderName;
}

export function getLocalSongRootFolderName(song: LocalSong): string | null {
    const sourcePath = song.folderName || song.filePath;
    const rootFolderName = sourcePath.split('/')[0]?.trim();
    return rootFolderName || null;
}
