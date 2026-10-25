import type { LocalLibrarySnapshotNode, LocalSong } from '../../types';
import { getDirHandles, getLocalLibrarySnapshot, getLocalSongs, saveLocalLibrarySnapshot, saveLocalSong } from '../db';
import { isAndroidNativeRuntime } from '../nativeLocalMusic';
import { getAccessibleFileHandle } from './fileHandles';
import { getRootFolderName } from './folderPaths';
import { notifyLocalMusicUpdated } from './libraryEvents';
import {
    KNOWN_AUDIO_EXTENSIONS,
    buildFileSignature,
    getAudioBasePath,
    getParentRelativePath,
    getSidecarLyricBasePath,
    getSnapshotFileKind,
    hashSnapshotNode,
} from './scanFiles';
import { fileHandleMap } from './state';

// src/services/localMusic/renameSong.ts
// Renames a song: the file and its sidecar lyrics where a file handle allows it, the display name
// everywhere else.

// ——— 重命名 ———
//
// 「管理歌曲」里的重命名在两端不是一回事：
//   · 桌面（含 Electron）拿的是用户自己那个文件的 FileSystemFileHandle，能把磁盘上的文件名
//     真改掉（handle.move）；同名 sidecar 歌词必须一起改 —— 歌词是按「去扩展名的 stem」配对的，
//     音频改了名、歌词没改，下次刷新就配不上，本地歌词直接丢。
//   · 安卓没有这条路：MediaStore 扫来的歌 App 没有写权限（分区存储会抛
//     RecoverableSecurityException）；挑选导入的歌是复制进 App 私有目录的副本，改它也只是改副本，
//     还得让原生回写 ref，否则下次播放会按旧名再拷一份。所以安卓只改曲库里显示的那个名字。
//
// 名字改完必须立刻把 song.filePath 一起改掉：重扫是按 filePath 认歌的（existingSongsByPath），
// 不同步改就会被判成「旧的那首删了 + 新的一首来了」—— id 换掉，歌单归属全丢。

export type LocalSongRenameResult = {
    ok: boolean;
    /** 磁盘上的文件名真的改了（只有桌面持句柄时能做到）。 */
    renamedFile: boolean;
    /** 改名之后的显示名；失败时是调用方传进来的原样。 */
    title: string;
    reason?: 'invalid' | 'not-found' | 'conflict' | 'no-handle' | 'unsupported' | 'error';
};

type MovableFileHandle = FileSystemFileHandle & { move?: (name: string) => Promise<void>; };

type SidecarLyricRename = {
    handle: FileSystemFileHandle;
    relativePath: string;
    newRelativePath: string;
    newName: string;
};

const RENAME_FORBIDDEN_CHARS = /[\\/]/;

const normalizeRenameInput = (raw: string): string | null => {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed || trimmed === '.' || trimmed === '..') return null;
    // 只收一个名字，不带路径：顺手挡掉把歌挪进别的目录这种超出重命名范围的操作。
    if (RENAME_FORBIDDEN_CHARS.test(trimmed)) return null;
    return trimmed;
};

const getAudioFileNameExtension = (fileName: string): string => (
    fileName.match(KNOWN_AUDIO_EXTENSIONS)?.[0] ?? ''
);

const domExceptionName = (error: unknown): string => (
    error instanceof DOMException ? error.name : ''
);

async function ensureDirectoryPermission(
    handle: FileSystemDirectoryHandle,
    mode: 'read' | 'readwrite',
): Promise<boolean> {
    const permissionAware = handle as FileSystemDirectoryHandle & {
        queryPermission?: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
        requestPermission?: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
    };
    if (typeof permissionAware.queryPermission !== 'function') {
        // 拿不到权限接口（老浏览器 / 非 Chromium）：句柄本来就是用户挑的，直接试。
        return true;
    }

    try {
        if (await permissionAware.queryPermission({ mode }) === 'granted') return true;
        if (typeof permissionAware.requestPermission !== 'function') return false;
        return await permissionAware.requestPermission({ mode }) === 'granted';
    } catch (error) {
        console.warn('[LocalMusic] Failed to query directory permission:', error);
        return false;
    }
}

async function resolveDirectoryHandleFromRoot(
    rootDirHandle: FileSystemDirectoryHandle,
    relativePathFromRoot: string,
): Promise<FileSystemDirectoryHandle> {
    let currentDir = rootDirHandle;
    for (const segment of relativePathFromRoot.split('/').filter(Boolean)) {
        currentDir = await currentDir.getDirectoryHandle(segment);
    }
    return currentDir;
}

/**
 * 歌词 sidecar 有两种命名："track.lrc" 与 "track.mp3.lrc"，两种都要跟着音频改。
 * 前缀匹配就够：命中哪个前缀就用哪个新前缀替换尾部。
 */
const deriveSidecarName = (
    lyricName: string,
    oldAudioName: string,
    newAudioName: string,
    oldStem: string,
    newStem: string,
): string | null => {
    if (oldAudioName && lyricName.startsWith(oldAudioName)) {
        return `${newAudioName}${lyricName.slice(oldAudioName.length)}`;
    }
    if (oldStem && lyricName.startsWith(oldStem)) {
        return `${newStem}${lyricName.slice(oldStem.length)}`;
    }
    return null;
};

async function collectSidecarLyricRenames(
    rootDirHandle: FileSystemDirectoryHandle,
    rootFolderName: string,
    parentPath: string,
    oldAudioRelativePath: string,
    newAudioName: string,
): Promise<SidecarLyricRename[]> {
    if (parentPath !== rootFolderName && !parentPath.startsWith(`${rootFolderName}/`)) {
        return [];
    }
    const parentPathFromRoot = parentPath === rootFolderName
        ? ''
        : parentPath.slice(rootFolderName.length + 1);

    let parentDir: FileSystemDirectoryHandle;
    try {
        parentDir = parentPathFromRoot
            ? await resolveDirectoryHandleFromRoot(rootDirHandle, parentPathFromRoot)
            : rootDirHandle;
    } catch (error) {
        console.warn(`[LocalMusic] Failed to open "${parentPath}" for lyric renaming:`, error);
        return [];
    }

    const oldAudioName = oldAudioRelativePath.split('/').pop() || '';
    const oldStem = getAudioBasePath(oldAudioName);
    const newStem = getAudioBasePath(newAudioName);
    const oldAudioBasePath = getAudioBasePath(oldAudioRelativePath);

    const entries: FileSystemFileHandle[] = [];
    try {
        // @ts-ignore - values() 不在所有 TypeScript 定义里
        for await (const entry of parentDir.values()) {
            if (entry.kind !== 'file') continue;
            entries.push(entry as FileSystemFileHandle);
        }
    } catch (error) {
        console.warn(`[LocalMusic] Failed to list "${parentPath}" for lyric renaming:`, error);
        return [];
    }

    return entries.reduce<SidecarLyricRename[]>((plan, handle) => {
        const relativePath = `${parentPath}/${handle.name}`;
        const kind = getSnapshotFileKind(handle.name);
        if (kind !== 'lyric' && kind !== 'translationLyric') return plan;
        if (getSidecarLyricBasePath(relativePath, kind) !== oldAudioBasePath) return plan;

        const newName = deriveSidecarName(handle.name, oldAudioName, newAudioName, oldStem, newStem);
        if (!newName || newName === handle.name) return plan;

        plan.push({ handle, relativePath, newName, newRelativePath: `${parentPath}/${newName}` });
        return plan;
    }, []);
}

/** 把快照树里这几个路径换成新路径，并自底向上重算 hash（hash 参与「目录变没变」的判定）。 */
function applyPathRenamesToSnapshot(
    node: LocalLibrarySnapshotNode,
    renames: ReadonlyMap<string, string>,
): boolean {
    let changed = false;
    node.children.forEach((child) => {
        if (applyPathRenamesToSnapshot(child, renames)) changed = true;
    });
    node.files.forEach((file) => {
        const nextPath = renames.get(file.relativePath);
        if (!nextPath || nextPath === file.relativePath) return;
        file.relativePath = nextPath;
        file.name = nextPath.split('/').pop() || file.name;
        file.signature = buildFileSignature(nextPath, file.size, file.lastModified);
        changed = true;
    });
    if (changed) {
        node.hash = hashSnapshotNode(node.relativePath, node.files, node.children);
    }
    return changed;
}

/** 只改曲库里显示的名字（安卓，或桌面拿不到句柄时的退路）。 */
async function persistDisplayNameRename(
    song: LocalSong,
    title: string,
    reason?: LocalSongRenameResult['reason'],
): Promise<LocalSongRenameResult> {
    // 'manual' 是重扫时的护身符：buildImportedSong 与 hydrateSongMetadata 只在
    // titleOrigin === 'import' 时用导入的标题覆盖，手动改的名字不会被冲掉。
    await saveLocalSong({ ...song, title, titleOrigin: 'manual' });
    notifyLocalMusicUpdated();
    return { ok: true, renamedFile: false, title, reason };
}

export async function renameLocalSong(songId: string, rawName: string): Promise<LocalSongRenameResult> {
    const name = normalizeRenameInput(rawName);
    if (!name) {
        return { ok: false, renamedFile: false, title: rawName.trim(), reason: 'invalid' };
    }

    const allSongs = await getLocalSongs();
    const song = allSongs.find(entry => entry.id === songId);
    if (!song) {
        return { ok: false, renamedFile: false, title: name, reason: 'not-found' };
    }

    if (isAndroidNativeRuntime()) {
        return await persistDisplayNameRename(song, name);
    }

    const handle = await getAccessibleFileHandle(song);
    if (!handle) {
        return await persistDisplayNameRename(song, name, 'no-handle');
    }
    const movable = handle as MovableFileHandle;
    if (typeof movable.move !== 'function') {
        return await persistDisplayNameRename(song, name, 'unsupported');
    }

    const extension = getAudioFileNameExtension(song.fileName);
    const newFileName = extension && !name.toLowerCase().endsWith(extension.toLowerCase())
        ? `${name}${extension}`
        : name;
    const oldRelativePath = song.filePath;
    const parentPath = getParentRelativePath(oldRelativePath);
    const newRelativePath = parentPath ? `${parentPath}/${newFileName}` : newFileName;

    // 名字没变（只改了大小写之外的东西 / 用户就是想改显示名）：不用动磁盘。
    if (!oldRelativePath || newFileName === song.fileName) {
        return await persistDisplayNameRename(song, name);
    }

    const pathRenames = new Map<string, string>([[oldRelativePath, newRelativePath]]);
    const rootFolderName = getRootFolderName(song);
    const dirHandles = await getDirHandles();
    const rootDirHandle = rootFolderName ? dirHandles?.[rootFolderName] : undefined;
    // 改名要写权限：导入那会儿只申请了 'read'。趁点击带来的用户手势还在把权限问到手 ——
    // 拿到一次，音频与歌词两边都够用；拿不到就只改音频（歌词没跟着改，总比改坏强）。
    const canWriteToRoot = rootDirHandle ? await ensureDirectoryPermission(rootDirHandle, 'readwrite') : false;

    try {
        await movable.move(newFileName);
    } catch (error) {
        console.warn(`[LocalMusic] Failed to rename "${oldRelativePath}" to "${newFileName}":`, error);
        const errorName = domExceptionName(error);
        if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
            return await persistDisplayNameRename(song, name, 'no-handle');
        }
        return {
            ok: false,
            renamedFile: false,
            title: song.title,
            reason: errorName === 'InvalidModificationError' ? 'conflict' : 'error',
        };
    }

    if (rootFolderName && rootDirHandle && canWriteToRoot) {
        try {
            const sidecars = await collectSidecarLyricRenames(
                rootDirHandle,
                rootFolderName,
                parentPath,
                oldRelativePath,
                newFileName,
            );
            for (const sidecar of sidecars) {
                const movableSidecar = sidecar.handle as MovableFileHandle;
                if (typeof movableSidecar.move !== 'function') continue;
                try {
                    await movableSidecar.move(sidecar.newName);
                    pathRenames.set(sidecar.relativePath, sidecar.newRelativePath);
                } catch (error) {
                    console.warn(`[LocalMusic] Failed to rename lyric file "${sidecar.relativePath}":`, error);
                }
            }
        } catch (error) {
            console.warn('[LocalMusic] Failed to collect sidecar lyric renames:', error);
        }
    }

    let file: File | null = null;
    try {
        file = await handle.getFile();
    } catch (error) {
        console.warn(`[LocalMusic] Failed to re-read renamed file "${newRelativePath}":`, error);
    }

    const renamed: LocalSong = { ...song };
    renamed.fileName = file?.name || newFileName;
    renamed.filePath = newRelativePath;
    if (file) {
        renamed.fileSize = file.size;
        renamed.fileLastModified = file.lastModified;
    }
    renamed.fileSignature = buildFileSignature(
        newRelativePath,
        renamed.fileSize ?? song.fileSize ?? 0,
        renamed.fileLastModified ?? song.fileLastModified ?? 0,
    );
    renamed.title = name;
    renamed.titleOrigin = 'manual';
    fileHandleMap.set(renamed.id, handle);
    renamed.fileHandle = handle;
    await saveLocalSong(renamed);

    if (rootFolderName) {
        const snapshot = await getLocalLibrarySnapshot(rootFolderName);
        if (snapshot && applyPathRenamesToSnapshot(snapshot.tree, pathRenames)) {
            await saveLocalLibrarySnapshot(snapshot).catch(error => (
                console.warn(`[LocalMusic] Failed to update snapshot for ${rootFolderName}:`, error)
            ));
        }
    }

    notifyLocalMusicUpdated();
    console.log(`[LocalMusic] Renamed "${oldRelativePath}" to "${newRelativePath}"`);
    return { ok: true, renamedFile: true, title: name };
}
