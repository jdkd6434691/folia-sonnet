import type { LocalSong } from '../../types';
import { createSafeObjectUrl } from '../../utils/blobGuards';
import { repairFlacMetadata } from '../../utils/flacMetadataRepair';
import { parseEmbeddedMetadataAsync, type EmbeddedMetadataResult } from '../../utils/localMetadataWorkerClient';
import { buildImportedMetadataSnapshot, extractMetadataFromFilename } from '../../utils/localSongMetadata';
import type { ExplicitFileTimedLyricFormat } from '../../utils/lyrics/formatDetection';
import { readLyricFile } from '../../utils/lyrics/lyricFileDecoding';
import { prepareLocalCoverBlob, stageLocalCoverAsset, type PreparedLocalCoverBlob } from '../localCoverAssetService';
import type { FileEntryForImport, LocalLyricFileCandidate } from './importPlan';
import { buildFileSignature, generateId, getAudioBasePath, isAudioFile } from './scanFiles';
import { fileHandleMap } from './state';

// src/services/localMusic/songImport.ts
// Reads one audio file's embedded tags, sidecar lyrics and folder cover into a LocalSong, and the
// version that makes an already imported song read its tags again.

type EmbeddedMetadata = EmbeddedMetadataResult;

/**
 * 8：给已入库的歌补一次歌手。
 *
 * 之前只有内嵌标签与 MediaStore 给了歌手才算有，两者都空（很常见）这首歌就永远没有歌手。
 * 现在 `buildImportedMetadataSnapshot` 会再退一步从文件名认，已经进库的歌得重抽一遍
 * 才吃得到 —— 版本号一变，扫描时 `embeddedMetadataVersion` 对不上就会重跑元数据。
 */
export const EMBEDDED_METADATA_VERSION = 8;

interface ImportPreparationMetrics {
    getFileMs: number;
    lyricReadMs: number;
    coverReadMs: number;
    parseMetadataMs: number;
    durationFallbackMs: number;
    usedDurationFallback: boolean;
}

// Get audio duration from file
async function getAudioDuration(file: File): Promise<number> {
    const playbackInput = await repairFlacMetadata(file, true);
    return new Promise((resolve) => {
        const audio = new Audio();
        const url = createSafeObjectUrl(playbackInput);
        if (!url) {
            resolve(0);
            return;
        }

        audio.addEventListener('loadedmetadata', () => {
            const duration = audio.duration * 1000; // Convert to milliseconds
            URL.revokeObjectURL(url);
            resolve(duration);
        });

        audio.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            resolve(0); // Default duration on error
        });

        audio.src = url;
    });
}

export async function extractEmbeddedMetadata(file: File, includeCover = false): Promise<EmbeddedMetadata> {
    const parsed = await parseEmbeddedMetadataAsync(file, includeCover);
    if (!parsed) {
        throw new Error('Metadata worker returned null');
    }
    return parsed;
}

export async function buildImportedSong(
    entry: FileEntryForImport,
    lrcMap: Map<string, LocalLyricFileCandidate>,
    tlrcMap: Map<string, File>,
    coverMap: Map<string, File>,
    coverBlobCache: Map<string, Promise<PreparedLocalCoverBlob | undefined>>,
    includeEmbeddedMetadata = true,
    existingSong?: LocalSong
): Promise<{ song: LocalSong | null; metrics: ImportPreparationMetrics; }> {
    const fileHandle = entry.handle;
    const file = entry.file;
    const getFileMs = 0;

    if (!isAudioFile(file)) {
        return {
            song: null,
            metrics: {
                getFileMs,
                lyricReadMs: 0,
                coverReadMs: 0,
                parseMetadataMs: 0,
                durationFallbackMs: 0,
                usedDurationFallback: false
            }
        };
    }

    const metadata = extractMetadataFromFilename(file.name);
    const baseName = getAudioBasePath(entry.relativePath);

    let localLyricsContent: string | undefined;
    let localLyricsFormat: ExplicitFileTimedLyricFormat | undefined;
    let localTranslationLyricsContent: string | undefined;
    const lyricReadStartedAt = performance.now();
    // Uploaded lyrics survive rescans (including a format order change) until a sidecar lyric of
    // this track changes on disk: whichever explicit action is newer wins.
    const keepUploadedLyrics = existingSong?.localLyricsOrigin === 'upload' && !entry.sidecarLyricFilesChanged;
    const keepUploadedTranslation = existingSong?.localTranslationLyricsOrigin === 'upload' && !entry.sidecarLyricFilesChanged;

    if (keepUploadedLyrics) {
        localLyricsContent = existingSong?.localLyricsContent;
        localLyricsFormat = existingSong?.localLyricsFormat;
    } else if (lrcMap.has(baseName)) {
        try {
            const lyricCandidate = lrcMap.get(baseName)!;
            localLyricsContent = await readLyricFile(lyricCandidate.file);
            localLyricsFormat = lyricCandidate.format;
        } catch (e) {
            console.error(`[LocalMusic] Failed to read local lyric for ${file.name}`, e);
        }
    }

    if (keepUploadedTranslation) {
        localTranslationLyricsContent = existingSong?.localTranslationLyricsContent;
    } else if (tlrcMap.has(baseName)) {
        try {
            localTranslationLyricsContent = await readLyricFile(tlrcMap.get(baseName)!);
        } catch (e) {
            console.error(`[LocalMusic] Failed to read local translation lyric for ${file.name}`, e);
        }
    }
    const lyricReadMs = performance.now() - lyricReadStartedAt;

    let folderCover: PreparedLocalCoverBlob | undefined;
    const coverReadStartedAt = performance.now();
    if (coverMap.has(entry.folderName)) {
        if (!coverBlobCache.has(entry.folderName)) {
            coverBlobCache.set(entry.folderName, (async () => {
                try {
                    return (await prepareLocalCoverBlob(coverMap.get(entry.folderName)!)) || undefined;
                } catch (error) {
                    console.warn(`[LocalMusic] Failed to read folder cover for ${entry.folderName}:`, error);
                    return undefined;
                }
            })());
        }
        folderCover = await coverBlobCache.get(entry.folderName)!;
    }
    const coverReadMs = performance.now() - coverReadStartedAt;

    let embeddedMetadata: EmbeddedMetadata = {};
    let parseMetadataMs = 0;
    if (includeEmbeddedMetadata) {
        const parseMetadataStartedAt = performance.now();

        try {
            embeddedMetadata = await extractEmbeddedMetadata(file, false);
        } catch (e) {
            console.warn(`[LocalMusic] Failed to parse metadata for ${file.name}:`, e);
        }
        parseMetadataMs = performance.now() - parseMetadataStartedAt;
    }

    let durationFallbackMs = 0;
    let usedDurationFallback = false;
    let duration = embeddedMetadata.duration || 0;
    if (includeEmbeddedMetadata && !duration) {
        usedDurationFallback = true;
        const durationFallbackStartedAt = performance.now();
        duration = await getAudioDuration(file);
        durationFallbackMs = performance.now() - durationFallbackStartedAt;
    }

    const songId = existingSong?.id || generateId();
    const importedMetadata = buildImportedMetadataSnapshot({
        fileName: file.name,
        embeddedTitle: embeddedMetadata.title,
        fallbackTitle: metadata.title,
        embeddedArtist: embeddedMetadata.artist,
        embeddedArtists: embeddedMetadata.artists,
        fallbackArtist: metadata.artist,
        embeddedAlbum: embeddedMetadata.album,
    });
    const titleOrigin = existingSong?.titleOrigin || 'import';
    const localSong: LocalSong = {
        ...existingSong,
        id: songId,
        fileName: file.name,
        filePath: entry.relativePath,
        duration,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        fileSignature: buildFileSignature(entry.relativePath, file.size, file.lastModified),
        mimeType: file.type,
        bitrate: embeddedMetadata.bitrate || 0,
        addedAt: existingSong?.addedAt || Date.now(),
        title: titleOrigin === 'import' ? importedMetadata.title : existingSong?.title || importedMetadata.title,
        titleOrigin,
        importedMetadata,
        onlineMetadata: existingSong?.onlineMetadata,
        trackNumber: embeddedMetadata.trackNumber,
        discNumber: embeddedMetadata.discNumber,
        localCoverAssetId: folderCover?.assetId,
        localCoverSource: folderCover ? 'folder' : undefined,
        localCoverNeedsAssetMigration: folderCover && !folderCover.assetId ? true : undefined,
        hasManualLyricSelection: existingSong?.hasManualLyricSelection ?? false,
        folderName: entry.folderName,
        hasLocalLyrics: !!localLyricsContent,
        localLyricsContent,
        localLyricsFormat: localLyricsContent ? localLyricsFormat : undefined,
        localLyricsOrigin: localLyricsContent ? (keepUploadedLyrics ? 'upload' : 'sidecar') : undefined,
        hasLocalTranslationLyrics: !!localTranslationLyricsContent,
        localTranslationLyricsContent,
        localTranslationLyricsOrigin: localTranslationLyricsContent ? (keepUploadedTranslation ? 'upload' : 'sidecar') : undefined,
        hasEmbeddedLyrics: !!embeddedMetadata.lyrics,
        embeddedLyricsContent: embeddedMetadata.lyrics,
        hasEmbeddedTranslationLyrics: !!embeddedMetadata.translationLyrics,
        embeddedTranslationLyricsContent: embeddedMetadata.translationLyrics,
        replayGain: embeddedMetadata.replayGain,
        replayGainTrackGain: embeddedMetadata.replayGainTrackGain,
        replayGainTrackPeak: embeddedMetadata.replayGainTrackPeak,
        replayGainAlbumGain: embeddedMetadata.replayGainAlbumGain,
        replayGainAlbumPeak: embeddedMetadata.replayGainAlbumPeak,
        matchedLyrics: existingSong?.matchedLyrics,
        matchedIsPureMusic: existingSong?.matchedIsPureMusic,
        markedPureMusic: existingSong?.markedPureMusic,
        matchedLyricsSongId: existingSong?.matchedLyricsSongId,
        matchedLyricsSource: existingSong?.matchedLyricsSource,
        matchedLyricsProviderPlatform: existingSong?.matchedLyricsProviderPlatform,
        noAutoMatch: existingSong?.noAutoMatch,
        lyricsSource: existingSong?.lyricsSource,
        useOnlineCover: existingSong?.useOnlineCover,
    };

    fileHandleMap.set(songId, fileHandle);
    localSong.fileHandle = fileHandle;

    return {
        song: localSong,
        metrics: {
            getFileMs,
            lyricReadMs,
            coverReadMs,
            parseMetadataMs,
            durationFallbackMs,
            usedDurationFallback
        }
    };
}

export async function hydrateSongMetadata(song: LocalSong): Promise<LocalSong> {
    const fileHandle = fileHandleMap.get(song.id) || song.fileHandle;
    if (!fileHandle) {
        return song;
    }

    try {
        const file = await fileHandle.getFile();
        const includeCover = song.localCoverSource !== 'folder';
        let embeddedMetadata: EmbeddedMetadata;
        let coverHydrationFailed = false;

        try {
            embeddedMetadata = await extractEmbeddedMetadata(file, includeCover);
        } catch (coverError) {
            if (!includeCover) throw coverError;
            coverHydrationFailed = true;
            console.warn(`[LocalMusic][Import] Cover-aware metadata parsing failed for ${song.fileName}; retrying without covers.`, coverError);
            embeddedMetadata = await extractEmbeddedMetadata(file, false);
        }

        song.duration = embeddedMetadata.duration || song.duration || 0;
        song.fileSize = file.size;
        // Kept in step with fileSize: buildLocalSourceRevision reads both, so refreshing only one
        // makes every cached playback representation look stale and re-transcode on each play.
        song.fileLastModified = file.lastModified;
        song.mimeType = file.type;
        song.bitrate = embeddedMetadata.bitrate || song.bitrate || 0;
        const filenameMetadata = extractMetadataFromFilename(file.name);
        song.importedMetadata = buildImportedMetadataSnapshot({
            fileName: file.name,
            embeddedTitle: embeddedMetadata.title,
            fallbackTitle: filenameMetadata.title,
            embeddedArtist: embeddedMetadata.artist,
            embeddedArtists: embeddedMetadata.artists,
            fallbackArtist: filenameMetadata.artist,
            embeddedAlbum: embeddedMetadata.album,
        });
        if (song.titleOrigin === 'import') song.title = song.importedMetadata.title;
        song.trackNumber = embeddedMetadata.trackNumber;
        song.discNumber = embeddedMetadata.discNumber;
        song.embeddedMetadataVersion = EMBEDDED_METADATA_VERSION;
        song.hasEmbeddedLyrics = !!embeddedMetadata.lyrics;
        song.embeddedLyricsContent = embeddedMetadata.lyrics;
        song.hasEmbeddedTranslationLyrics = !!embeddedMetadata.translationLyrics;
        song.embeddedTranslationLyricsContent = embeddedMetadata.translationLyrics;
        song.replayGain = embeddedMetadata.replayGain;
        song.replayGainTrackGain = embeddedMetadata.replayGainTrackGain;
        song.replayGainTrackPeak = embeddedMetadata.replayGainTrackPeak;
        song.replayGainAlbumGain = embeddedMetadata.replayGainAlbumGain;
        song.replayGainAlbumPeak = embeddedMetadata.replayGainAlbumPeak;
        if (includeCover) {
            stageLocalCoverAsset(embeddedMetadata.coverAssetId, embeddedMetadata.cover);
            song.localCoverAssetId = embeddedMetadata.coverAssetId;
            song.localCoverSource = embeddedMetadata.cover ? 'embedded' : undefined;
            song.localCoverNeedsAssetMigration = coverHydrationFailed ? true : undefined;
        }
    } catch (error) {
        console.warn(`[LocalMusic][Import] Failed to hydrate metadata for ${song.fileName}:`, error);
    }

    return song;
}
