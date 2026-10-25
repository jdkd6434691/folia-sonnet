import type { LocalLibrarySnapshot, LocalLibrarySnapshotFile, LocalSong } from '../../types';
import { resolveExplicitFileTimedLyricFormat, type ExplicitFileTimedLyricFormat } from '../../utils/lyrics/formatDetection';
import { getLocalLyricFilePriority, isSameLocalLyricFormatOrder, normalizeLocalLyricFormatOrder, type LocalLyricFileFormat } from '../../utils/lyrics/localLyricFormatOrder';
import { EMBEDDED_METADATA_VERSION } from './songImport';
import {
    buildSnapshotTree,
    collectLyricBasePathsAffectedByFormatOrder,
    flattenSnapshotFiles,
    getAudioBasePath,
    getFolderCoverPriority,
    getParentRelativePath,
    getSidecarLyricBasePath,
} from './scanFiles';
import { fileHandleMap } from './state';

// src/services/localMusic/importPlan.ts
// The diff between a scanned folder and what is already imported: what changed, what was removed,
// and the sidecar lyrics and folder covers that go with each audio file.

export interface FileEntryForImport {
    handle: FileSystemFileHandle;
    file: File;
    folderName: string;
    relativePath: string;
    // A sidecar lyric file of this track was added or modified on disk since the last scan.
    sidecarLyricFilesChanged?: boolean;
}

export interface LocalLyricFileCandidate {
    file: File;
    format?: ExplicitFileTimedLyricFormat;
}

interface ImportDiffPlan {
    changedEntries: FileEntryForImport[];
    reusedSongs: LocalSong[];
    removedSongs: LocalSong[];
    totalAudioFiles: number;
    relevantFileCount: number;
    lrcMap: Map<string, LocalLyricFileCandidate>;
    tlrcMap: Map<string, File>;
    coverMap: Map<string, File>;
    snapshot: LocalLibrarySnapshot;
}

export async function collectImportDiffPlan(
    rootFolderName: string,
    dirHandle: FileSystemDirectoryHandle,
    existingSongs: LocalSong[],
    previousSnapshot: LocalLibrarySnapshot | null,
    lyricFormatOrder: LocalLyricFileFormat[]
): Promise<ImportDiffPlan> {
    const ignoredFolderPaths = previousSnapshot?.ignoredFolderPaths || [];
    const traversalResult = await buildSnapshotTree(dirHandle, rootFolderName, rootFolderName, [], new Map(), new Set(ignoredFolderPaths));
    const snapshot: LocalLibrarySnapshot = {
        rootFolderName,
        scannedAt: Date.now(),
        ignoredFolderPaths,
        lyricFormatOrder,
        tree: traversalResult.tree
    };

    const currentFiles = flattenSnapshotFiles(snapshot.tree);
    const previousFiles = previousSnapshot ? flattenSnapshotFiles(previousSnapshot.tree) : new Map<string, LocalLibrarySnapshotFile>();
    const existingSongsByPath = new Map(existingSongs.map(song => [song.filePath, song]));
    const currentAudioPaths = new Set<string>();
    const changedAudioPaths = new Set<string>();
    const changedLyricBasePaths = new Set<string>();
    // Subset of changedLyricBasePaths whose files changed on disk, as opposed to only being
    // re-ranked by a format order change. Only these may replace lyrics the user uploaded.
    const lyricFileChangedBasePaths = new Set<string>();
    const changedCoverFolders = new Set<string>();
    // Built in the same pass over the current files, so mapping a changed sidecar or folder cover
    // back to its tracks is a lookup instead of a scan of the whole library per path.
    const audioPathsByBasePath = new Map<string, string[]>();
    const audioPathsByFolder = new Map<string, string[]>();
    const appendToGroup = (groups: Map<string, string[]>, key: string, value: string) => {
        const group = groups.get(key);
        if (group) {
            group.push(value);
        } else {
            groups.set(key, [value]);
        }
    };
    const lyricCandidates = new Map<string, { file: File; priority: number; format?: ExplicitFileTimedLyricFormat; }>();
    const translationLyricCandidates = new Map<string, { file: File; priority: number; }>();
    const coverCandidates = new Map<string, { file: File; priority: number; }>();

    currentFiles.forEach((file) => {
        const previousFile = previousFiles.get(file.relativePath);
        const hasChanged = !previousFile || previousFile.signature !== file.signature || previousFile.kind !== file.kind;

        if (file.kind === 'audio') {
            currentAudioPaths.add(file.relativePath);
            appendToGroup(audioPathsByBasePath, getAudioBasePath(file.relativePath), file.relativePath);
            appendToGroup(audioPathsByFolder, getParentRelativePath(file.relativePath), file.relativePath);
            if (hasChanged || !existingSongsByPath.has(file.relativePath)) {
                changedAudioPaths.add(file.relativePath);
            }
            return;
        }

        if (hasChanged && (file.kind === 'lyric' || file.kind === 'translationLyric')) {
            const basePath = getSidecarLyricBasePath(file.relativePath, file.kind);
            changedLyricBasePaths.add(basePath);
            lyricFileChangedBasePaths.add(basePath);
        }

        if (file.kind === 'cover' && hasChanged) {
            changedCoverFolders.add(getParentRelativePath(file.relativePath));
        }
    });

    // Snapshots written before the order became configurable were scanned with the default order.
    const previousLyricFormatOrder = normalizeLocalLyricFormatOrder(previousSnapshot?.lyricFormatOrder);
    if (previousSnapshot && !isSameLocalLyricFormatOrder(previousLyricFormatOrder, lyricFormatOrder)) {
        collectLyricBasePathsAffectedByFormatOrder(Array.from(currentFiles.values()), previousLyricFormatOrder, lyricFormatOrder)
            .forEach(basePath => changedLyricBasePaths.add(basePath));
    }

    const previousAudioPaths = Array.from(previousFiles.values())
        .filter(file => file.kind === 'audio')
        .map(file => file.relativePath);

    previousAudioPaths.forEach((relativePath) => {
        if (!currentAudioPaths.has(relativePath)) {
            const removedSong = existingSongsByPath.get(relativePath);
            if (removedSong) {
                existingSongsByPath.delete(relativePath);
            }
        }
    });

    // "Track.mp3" and "Track.flac" share one sidecar, so every track with that base path is rebuilt.
    changedLyricBasePaths.forEach(basePath => {
        audioPathsByBasePath.get(basePath)?.forEach(audioPath => changedAudioPaths.add(audioPath));
    });

    previousFiles.forEach((file) => {
        if (file.kind === 'cover' && !currentFiles.has(file.relativePath)) {
            changedCoverFolders.add(getParentRelativePath(file.relativePath));
        }
    });

    changedCoverFolders.forEach(folderPath => {
        audioPathsByFolder.get(folderPath)?.forEach(audioPath => changedAudioPaths.add(audioPath));
    });

    const changedEntries: FileEntryForImport[] = [];
    const reusedSongs: LocalSong[] = [];
    const removedSongs = existingSongs.filter(song => !currentAudioPaths.has(song.filePath));
    const allRelevantFiles = Array.from(currentFiles.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const snapshotFile of allRelevantFiles) {
        const traversedFile = traversalResult.filesByPath.get(snapshotFile.relativePath);
        if (!traversedFile) {
            console.warn(`[LocalMusic][Import] Missing traversed file handle for "${snapshotFile.relativePath}".`);
            continue;
        }

        const pathSegments = snapshotFile.relativePath.split('/');
        const fileName = pathSegments[pathSegments.length - 1];
        const folderName = pathSegments.slice(0, -1).join('/');

        if (snapshotFile.kind === 'lyric' || snapshotFile.kind === 'translationLyric') {
            const baseName = getSidecarLyricBasePath(snapshotFile.relativePath, snapshotFile.kind);
            const priority = getLocalLyricFilePriority(snapshotFile.name, lyricFormatOrder);
            const format = resolveExplicitFileTimedLyricFormat(snapshotFile.name);

            if (snapshotFile.kind === 'translationLyric') {
                const existingTranslationLyric = translationLyricCandidates.get(baseName);
                if (!existingTranslationLyric || priority < existingTranslationLyric.priority) {
                    translationLyricCandidates.set(baseName, { file: traversedFile.file, priority });
                }
            } else {
                const existingLyric = lyricCandidates.get(baseName);
                if (!existingLyric || priority < existingLyric.priority) {
                    lyricCandidates.set(baseName, { file: traversedFile.file, priority, format });
                }
            }
            continue;
        }

        if (snapshotFile.kind === 'cover') {
            const folderKey = getParentRelativePath(snapshotFile.relativePath);
            const priority = getFolderCoverPriority(snapshotFile.name);
            const existingCover = coverCandidates.get(folderKey);

            if (!existingCover || priority < existingCover.priority) {
                coverCandidates.set(folderKey, { file: traversedFile.file, priority });
            }
            continue;
        }

        if (snapshotFile.kind !== 'audio') {
            continue;
        }

        const existingSong = existingSongsByPath.get(snapshotFile.relativePath);

        if (
            changedAudioPaths.has(snapshotFile.relativePath)
            || !existingSong
            || existingSong.embeddedMetadataVersion !== EMBEDDED_METADATA_VERSION
            || existingSong.localCoverNeedsAssetMigration
        ) {
            changedEntries.push({
                handle: traversedFile.handle,
                file: traversedFile.file,
                folderName,
                relativePath: snapshotFile.relativePath,
                sidecarLyricFilesChanged: lyricFileChangedBasePaths.has(getAudioBasePath(snapshotFile.relativePath)),
            });
            continue;
        }

        fileHandleMap.set(existingSong.id, traversedFile.handle);
        existingSong.fileHandle = traversedFile.handle;
        existingSong.fileSize = snapshotFile.size;
        existingSong.fileLastModified = snapshotFile.lastModified;
        existingSong.fileSignature = snapshotFile.signature;
        reusedSongs.push(existingSong);
    }

    return {
        changedEntries,
        reusedSongs,
        removedSongs,
        totalAudioFiles: currentAudioPaths.size,
        relevantFileCount: traversalResult.relevantFileCount,
        lrcMap: new Map(Array.from(lyricCandidates.entries()).map(([baseName, value]) => [baseName, { file: value.file, format: value.format }])),
        tlrcMap: new Map(Array.from(translationLyricCandidates.entries()).map(([baseName, value]) => [baseName, value.file])),
        coverMap: new Map(Array.from(coverCandidates.entries()).map(([folderKey, value]) => [folderKey, value.file])),
        snapshot
    };
}
