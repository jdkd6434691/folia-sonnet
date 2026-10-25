import type { LocalSong } from '../../types';
import { deleteDirHandle, deleteLocalLibrarySnapshot, getDirHandles, getLocalLibrarySnapshot, getLocalSongs, saveLocalSong } from '../db';
import { getLocalLibraryAvailability } from '../localLibraryAvailability';
import { isAndroidNativeRuntime } from '../nativeLocalMusic';
import { getRootFolderName, songBelongsToRootFolder } from './folderPaths';
import { fileHandleMap } from './state';

// src/services/localMusic/fileHandles.ts
// Finds the File System Access handle of an imported folder or song: the one held in memory, the
// directory handle persisted in IndexedDB, or the picker the user just used.

const REIMPORT_HANDLE_MISSING_ERROR = 'Missing persisted directory handle for reimport';

export async function getImportDirectoryHandle(expectedRootName?: string): Promise<FileSystemDirectoryHandle | null> {
    if (expectedRootName) {
        const dirHandles = await getDirHandles();
        const persistedHandle = dirHandles[expectedRootName];

        if (!persistedHandle) {
            throw new Error(REIMPORT_HANDLE_MISSING_ERROR);
        }

        const permissionAwareHandle = persistedHandle as FileSystemDirectoryHandle & {
            queryPermission: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
            requestPermission: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
        };

        let permission = await permissionAwareHandle.queryPermission({ mode: 'read' });
        if (permission !== 'granted') {
            permission = await permissionAwareHandle.requestPermission({ mode: 'read' });
        }

        if (permission !== 'granted') {
            return null;
        }

        return persistedHandle;
    }

    const availability = getLocalLibraryAvailability();
    if (!availability.supported) throw new Error(`Local library unavailable: ${availability.reason}`);

    // 安卓走原生，曲库里没有也不可能有持久化的目录句柄。可用性判定在那边是「原生可用」，
    // 但 WebView 仍然没有 showDirectoryPicker —— 不挡住的话这里会直接抛
    // 「showDirectoryPicker is not a function」。
    if (isAndroidNativeRuntime()) return null;

    // @ts-ignore - showDirectoryPicker is not in all TypeScript definitions
    return await window.showDirectoryPicker();
}

export async function findImportedRootForHandle(dirHandle: FileSystemDirectoryHandle): Promise<string | null> {
    const dirHandles = await getDirHandles();
    const selectedHandle = dirHandle as FileSystemDirectoryHandle & {
        isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
    };

    if (!selectedHandle.isSameEntry) {
        return null;
    }

    for (const [rootFolderName, persistedHandle] of Object.entries(dirHandles)) {
        try {
            if (await selectedHandle.isSameEntry(persistedHandle)) {
                return rootFolderName;
            }
        } catch (error) {
            console.warn(`[LocalMusic][Import] Failed to compare imported directory with "${rootFolderName}":`, error);
        }
    }

    return null;
}

async function resolveFileHandleFromDirHandle(
    dirHandle: FileSystemDirectoryHandle,
    relativePathFromRoot: string
): Promise<FileSystemFileHandle> {
    const pathSegments = relativePathFromRoot.split('/').filter(Boolean);
    if (pathSegments.length === 0) {
        throw new Error('Cannot resolve a file handle from an empty path.');
    }

    const fileName = pathSegments[pathSegments.length - 1];
    const directorySegments = pathSegments.slice(0, -1);

    let currentDir = dirHandle;
    for (const segment of directorySegments) {
        currentDir = await currentDir.getDirectoryHandle(segment);
    }

    return await currentDir.getFileHandle(fileName);
}

export async function recoverFileHandleFromPersistedDirectory(song: LocalSong): Promise<FileSystemFileHandle | null> {
    const rootFolderName = getRootFolderName(song);
    if (!rootFolderName || !song.filePath) {
        return null;
    }

    const dirHandles = await getDirHandles();
    const rootDirHandle = dirHandles[rootFolderName];
    if (!rootDirHandle) {
        return null;
    }

    const permissionAwareHandle = rootDirHandle as FileSystemDirectoryHandle & {
        queryPermission: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
    };
    const permission = await permissionAwareHandle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') {
        return null;
    }

    const relativePathFromRoot = song.filePath.startsWith(`${rootFolderName}/`)
        ? song.filePath.slice(rootFolderName.length + 1)
        : song.filePath;

    try {
        const recoveredHandle = await resolveFileHandleFromDirHandle(rootDirHandle, relativePathFromRoot);
        fileHandleMap.set(song.id, recoveredHandle);
        song.fileHandle = recoveredHandle;
        await saveLocalSong(song);
        return recoveredHandle;
    } catch (error) {
        console.warn(`[LocalMusic] Failed to recover file handle for ${song.filePath}:`, error);
        return null;
    }
}

export async function getAccessibleFileHandle(song: LocalSong): Promise<FileSystemFileHandle | null> {
    let fileHandle = fileHandleMap.get(song.id);

    if (!fileHandle && song.fileHandle) {
        fileHandle = song.fileHandle;
        fileHandleMap.set(song.id, fileHandle);
    }

    if (fileHandle) {
        return fileHandle;
    }

    return await recoverFileHandleFromPersistedDirectory(song);
}

export async function cleanupDirHandleIfUnused(rootFolderName: string): Promise<void> {
    if ((await getLocalLibrarySnapshot(rootFolderName))?.ignoredFolderPaths?.length) return;
    const allSongs = await getLocalSongs();
    const stillUsed = allSongs.some(song => songBelongsToRootFolder(song, rootFolderName));

    if (!stillUsed) {
        await deleteDirHandle(rootFolderName);
        await deleteLocalLibrarySnapshot(rootFolderName);
        console.log(`[LocalMusic] Removed persisted directory handle for ${rootFolderName}`);
    }
}
