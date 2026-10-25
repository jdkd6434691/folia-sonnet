import type { LocalLibrarySnapshotFile, LocalLibrarySnapshotNode } from '../../types';
import { createFoliaIgnoreMatcher, isIgnoredByFoliaMatchers, type FoliaIgnoreMatcher } from '../../utils/foliaIgnore';
import { getLocalLyricFilePriority, type LocalLyricFileFormat } from '../../utils/lyrics/localLyricFormatOrder';

// src/services/localMusic/scanFiles.ts
// File and path helpers for a local scan, the snapshot tree it walks, and the hashing that says
// whether a directory changed.

const BROWSER_AUDIO_EXTENSIONS = /\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i;
const ELECTRON_FALLBACK_AUDIO_EXTENSIONS = /\.(alac|ape|wv|tta|wma|aif|aiff|caf|dsf|dff)$/i;
export const KNOWN_AUDIO_EXTENSIONS = /\.(mp3|flac|m4a|wav|ogg|opus|aac|alac|ape|wv|tta|wma|aif|aiff|caf|dsf|dff)$/i;
const LYRIC_EXTENSIONS = /\.(lrc|vtt|ttml|qrc|yrc|krc|fia)$/i;
const TRANSLATION_LYRIC_EXTENSIONS = /\.t\.(lrc|vtt)$/i;
export const IMPORT_CONCURRENCY = 6;

const SNAPSHOT_HASH_SEED = 2166136261;

const PREFERRED_FOLDER_COVER_FILES = ['cover.png', 'cover.jpg', 'cover.jpeg'];

export function formatImportDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms.toFixed(1)}ms`;
    }

    return `${(ms / 1000).toFixed(2)}s`;
}

// Generate UUID for local songs
export function generateId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function canImportElectronFallbackAudio(): boolean {
    return typeof window !== 'undefined' && typeof window.electron?.requestTranscodeFallback === 'function';
}

export function isAudioFile(file: File): boolean {
    return BROWSER_AUDIO_EXTENSIONS.test(file.name)
        || (canImportElectronFallbackAudio() && ELECTRON_FALLBACK_AUDIO_EXTENSIONS.test(file.name));
}

function isAudioFileName(fileName: string): boolean {
    return BROWSER_AUDIO_EXTENSIONS.test(fileName)
        || (canImportElectronFallbackAudio() && ELECTRON_FALLBACK_AUDIO_EXTENSIONS.test(fileName));
}

export function getFolderCoverPriority(fileName: string): number {
    return PREFERRED_FOLDER_COVER_FILES.indexOf(fileName.toLowerCase());
}

export function getParentRelativePath(relativePath: string): string {
    const lastSlashIndex = relativePath.lastIndexOf('/');
    return lastSlashIndex === -1 ? '' : relativePath.slice(0, lastSlashIndex);
}

export function getAudioBasePath(relativePath: string): string {
    return relativePath.replace(KNOWN_AUDIO_EXTENSIONS, '');
}

export function getSidecarLyricBasePath(relativePath: string, kind: 'lyric' | 'translationLyric'): string {
    const withoutLyricSuffix = kind === 'translationLyric'
        ? relativePath.replace(/\.t\.(lrc|vtt)$/i, '')
        : relativePath.replace(/\.(lrc|vtt|ttml|qrc|yrc|krc|fia)$/i, '');

    // Support both "track.lrc" and "track.mp3.lrc" style sidecar lyrics.
    return getAudioBasePath(withoutLyricSuffix);
}

// Sidecar lyric base paths whose winning file differs between two format orders. Only these
// tracks need their lyrics re-read after the user reorders formats.
export function collectLyricBasePathsAffectedByFormatOrder(
    files: LocalLibrarySnapshotFile[],
    previousOrder: readonly LocalLyricFileFormat[],
    nextOrder: readonly LocalLyricFileFormat[],
): Set<string> {
    const pickWinners = (order: readonly LocalLyricFileFormat[]) => {
        const winners = new Map<string, { relativePath: string; priority: number; }>();
        files.forEach((file) => {
            if (file.kind !== 'lyric' && file.kind !== 'translationLyric') {
                return;
            }
            const key = `${file.kind}:${getSidecarLyricBasePath(file.relativePath, file.kind)}`;
            const priority = getLocalLyricFilePriority(file.name, order);
            const existing = winners.get(key);
            if (!existing || priority < existing.priority) {
                winners.set(key, { relativePath: file.relativePath, priority });
            }
        });
        return winners;
    };

    const previousWinners = pickWinners(previousOrder);
    const affected = new Set<string>();
    pickWinners(nextOrder).forEach((winner, key) => {
        if (previousWinners.get(key)?.relativePath !== winner.relativePath) {
            affected.add(key.slice(key.indexOf(':') + 1));
        }
    });
    return affected;
}

export function getSnapshotFileKind(fileName: string): LocalLibrarySnapshotFile['kind'] {
    const lowerName = fileName.toLowerCase();
    if (TRANSLATION_LYRIC_EXTENSIONS.test(lowerName)) {
        return 'translationLyric';
    }
    if (LYRIC_EXTENSIONS.test(lowerName)) {
        return 'lyric';
    }
    if (getFolderCoverPriority(lowerName) !== -1) {
        return 'cover';
    }
    if (isAudioFileName(fileName)) {
        return 'audio';
    }
    return 'other';
}

export function buildFileSignature(relativePath: string, size: number, lastModified: number): string {
    return `${relativePath}::${size}::${lastModified}`;
}

function hashString(input: string): string {
    let hash = SNAPSHOT_HASH_SEED;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashSnapshotNode(
    relativePath: string,
    files: LocalLibrarySnapshotFile[],
    children: LocalLibrarySnapshotNode[]
): string {
    const normalizedFiles = files
        .map(file => `${file.kind}:${file.relativePath}:${file.size}:${file.lastModified}`)
        .sort()
        .join('|');
    const normalizedChildren = children
        .map(child => `${child.relativePath}:${child.hash}`)
        .sort()
        .join('|');

    return hashString(`${relativePath}__${normalizedFiles}__${normalizedChildren}`);
}

function getDurationFromParsedMetadata(durationSeconds?: number): number {
    if (typeof durationSeconds !== 'number' || !isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
    }

    return Math.round(durationSeconds * 1000);
}

export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= items.length) {
                return;
            }

            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    };

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

interface SnapshotTraversalResult {
    tree: LocalLibrarySnapshotNode;
    relevantFileCount: number;
    filesByPath: Map<string, SnapshotTraversalFile>;
}

interface SnapshotTraversalFile {
    handle: FileSystemFileHandle;
    file: File;
}

export async function buildSnapshotTree(
    handle: FileSystemDirectoryHandle,
    currentPath: string,
    rootFolderName: string,
    inheritedIgnoreMatchers: readonly FoliaIgnoreMatcher[],
    filesByPath = new Map<string, SnapshotTraversalFile>(),
    ignoredFolderPaths: ReadonlySet<string> = new Set(),
): Promise<SnapshotTraversalResult> {
    const files: LocalLibrarySnapshotFile[] = [];
    const children: LocalLibrarySnapshotNode[] = [];
    let relevantFileCount = 0;

    const directoryRelativePath = currentPath === rootFolderName
        ? ''
        : currentPath.slice(rootFolderName.length + 1);
    const childEntries: Array<FileSystemHandle> = [];

    try {
        // @ts-ignore
        for await (const entry of handle.values()) {
            childEntries.push(entry);
        }
    } catch (error) {
        console.warn(`[LocalMusic][Import] Skip unreadable directory "${currentPath}":`, error);

        return {
            tree: {
                name: handle.name,
                relativePath: currentPath,
                hash: hashSnapshotNode(currentPath, [], []),
                files: [],
                children: []
            },
            relevantFileCount: 0,
            filesByPath,
        };
    }

    childEntries.sort((a, b) => a.name.localeCompare(b.name));
    const ignoreHandle = childEntries.find(entry => entry.kind === 'file' && entry.name === '.foliaignore');
    const localIgnoreMatcher = await loadFoliaIgnoreMatcher(
        ignoreHandle as FileSystemFileHandle | undefined,
        directoryRelativePath,
        handle.name,
    );
    const ignoreMatchers = localIgnoreMatcher.ruleCount > 0
        ? [...inheritedIgnoreMatchers, localIgnoreMatcher]
        : inheritedIgnoreMatchers;

    for (const entry of childEntries) {
        if (entry.name === '.foliaignore') {
            continue;
        }

        const entryPath = `${currentPath}/${entry.name}`;
        if (entry.kind === 'directory' && ignoredFolderPaths.has(entryPath)) {
            children.push({ name: entry.name, relativePath: entryPath, ignored: true, hash: '', files: [], children: [] });
            continue;
        }
        const importRelativePath = entryPath.startsWith(`${rootFolderName}/`)
            ? entryPath.slice(rootFolderName.length + 1)
            : entryPath;
        if (isIgnoredByFoliaMatchers(ignoreMatchers, importRelativePath, entry.kind === 'directory')) {
            continue;
        }

        if (entry.kind === 'directory') {
            const childPath = entryPath;

            try {
                const childResult = await buildSnapshotTree(
                    entry as FileSystemDirectoryHandle,
                    childPath,
                    rootFolderName,
                    ignoreMatchers,
                    filesByPath,
                    ignoredFolderPaths,
                );
                children.push(childResult.tree);
                relevantFileCount += childResult.relevantFileCount;
            } catch (error) {
                console.warn(`[LocalMusic][Import] Skip failed child directory "${childPath}":`, error);
            }

            continue;
        }

        const kind = getSnapshotFileKind(entry.name);
        if (kind === 'other') {
            continue;
        }

        const fileHandle = entry as FileSystemFileHandle;

        try {
            const file = await fileHandle.getFile();
            const relativePath = `${currentPath}/${file.name}`;
            const signature = buildFileSignature(relativePath, file.size, file.lastModified);

            files.push({
                name: file.name,
                relativePath,
                kind,
                size: file.size,
                lastModified: file.lastModified,
                signature
            });
            filesByPath.set(relativePath, { handle: fileHandle, file });
            relevantFileCount += 1;
        } catch (error) {
            console.warn(`[LocalMusic][Import] Skip unreadable file "${currentPath}/${entry.name}":`, error);
        }
    }

    const tree: LocalLibrarySnapshotNode = {
        name: handle.name,
        relativePath: currentPath,
        hash: hashSnapshotNode(currentPath, files, children),
        files,
        children
    };

    return { tree, relevantFileCount, filesByPath };
}

async function loadFoliaIgnoreMatcher(
    ignoreHandle: FileSystemFileHandle | undefined,
    baseDirectory: string,
    directoryName: string,
): Promise<FoliaIgnoreMatcher> {
    if (!ignoreHandle) {
        return createFoliaIgnoreMatcher('', baseDirectory);
    }

    try {
        const ignoreFile = await ignoreHandle.getFile();
        const matcher = createFoliaIgnoreMatcher(await ignoreFile.text(), baseDirectory);
        console.log(`[LocalMusic][Import] Loaded ${matcher.ruleCount} .foliaignore rules from "${directoryName}".`);
        return matcher;
    } catch (error) {
        console.warn(`[LocalMusic][Import] Failed to read .foliaignore from "${directoryName}":`, error);
        return createFoliaIgnoreMatcher('', baseDirectory);
    }
}

export function flattenSnapshotFiles(node: LocalLibrarySnapshotNode, target = new Map<string, LocalLibrarySnapshotFile>()) {
    node.files.forEach(file => {
        target.set(file.relativePath, file);
    });
    node.children.forEach(child => flattenSnapshotFiles(child, target));
    return target;
}
