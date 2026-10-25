import type { LocalSong } from '../../types';
import { saveLocalSong } from '../db';
import { stageLocalCoverAsset } from '../localCoverAssetService';
import { hasLocalCoverBinary } from '../localCoverBinaryStore';
import { nativeAudioUrlForRef } from '../nativeLocalMusic';
import { getAccessibleFileHandle, recoverFileHandleFromPersistedDirectory } from './fileHandles';
import { notifyLocalCoverReady } from './libraryEvents';
import { extractEmbeddedMetadata } from './songImport';
import { fileHandleMap, localCoverAssetRequestMap, songsWithoutEmbeddedCover } from './state';

// src/services/localMusic/covers.ts
// Extracts a song's embedded cover once and keeps the result, so a screen of tiles does not parse
// the same file again on every pass.

// Extracts and persists one song's embedded cover after an explicit playback-time request.

async function extractAndPersistSongCover(
    song: LocalSong,
    fileHandle: FileSystemFileHandle | null,
    file?: File,
): Promise<LocalSong> {
    // 安卓没有 File System Access 句柄，字节只能从原生回环服务那份 File 里来；桌面走句柄。
    const source = file ?? await fileHandle?.getFile();
    if (!source) return song;
    // 抽不出封面的文件按「内容修订」记一笔：同一首歌反复进屏时不再重复解一遍整段元数据。
    // 安卓那条路只取头部 1MB，截断文件的修订与整份不同，所以整份路径仍会再试一次。
    const fileRevision = `${source.size}:${source.lastModified}`;
    if (songsWithoutEmbeddedCover.get(song.id) === fileRevision) return song;
    const metadata = await extractEmbeddedMetadata(source, true);
    if (!metadata.cover || !metadata.coverAssetId) {
        songsWithoutEmbeddedCover.set(song.id, fileRevision);
        return song;
    }
    songsWithoutEmbeddedCover.delete(song.id);
    stageLocalCoverAsset(metadata.coverAssetId, metadata.cover);

    const previousAssetId = song.localCoverAssetId;
    const updatedSong: LocalSong = {
        ...song,
        localCoverAssetId: metadata.coverAssetId,
        localCoverSource: 'embedded',
        // 安卓没有 File System Access 句柄，这里不能凭空塞一个：留原值（undefined）。
        ...(fileHandle ? { fileHandle } : {}),
    };
    Object.assign(song, updatedSong);
    await saveLocalSong(updatedSong);
    /*
     * 封面是**现在**才有的。曲库列表直接按记录的 `localCoverAssetId` 现算，管不到；
     * 队列（磁贴墙）烤的是建队那一刻的快照，只有靠这个事件去补。
     */
    if (previousAssetId !== updatedSong.localCoverAssetId) {
        notifyLocalCoverReady(updatedSong.id, metadata.coverAssetId);
    }
    return updatedSong;
}

/** 只取文件头部多少字节来找内嵌封面。 */
const COVER_HEAD_BYTES = 1024 * 1024;

/**
 * 安卓上把音频取回来当 File。
 *
 * 本地歌在安卓走的是原生回环服务（`nativeAudioRef`），**没有 File System Access 句柄** ——
 * 而 ensureLocalSongCoverAsset 之前只认句柄，拿不到就直接放弃。
 * 结果是：安卓本地歌的封面**只有导入那一次**有机会抽出来（导入时解析内嵌元数据），
 * 那一趟一旦失败（比如副本那次 fetch 404），这首歌就永远没有封面 ——
 * 队列磁贴、播放页全是空白。这里让封面抽取也能从原生回环那份字节里拿。
 *
 * `headOnly` 只取前 1MB：内嵌封面（ID3 的 APIC、FLAC 的 picture 块）几乎都在文件头部，
 * 而整首拉回来对一首 8 分钟的 FLAC 就是几十 MB —— 给一整屏卡片补封面时不该付这个代价。
 * 取不到就返回 null，调用方（播放时那条路径）会再不带限制地试一次。
 */
async function nativeAudioFile(song: LocalSong, headOnly = false): Promise<File | null> {
    if (!song.nativeAudioRef) return null;
    const url = await nativeAudioUrlForRef(song.nativeAudioRef);
    if (!url) return null;
    try {
        const response = await fetch(url, headOnly ? { headers: { Range: `bytes=0-${COVER_HEAD_BYTES - 1}` } } : undefined);
        // 原生回环服务支持 Range，回了 206 也算成功。
        if (!response.ok && response.status !== 206) return null;
        const blob = await response.blob();
        if (blob.size <= 0) return null;
        return new File([blob], song.fileName || 'audio', { type: song.mimeType || 'audio/*' });
    } catch {
        return null;
    }
}

export async function ensureLocalSongCoverAsset(
    song: LocalSong,
    options?: { preferHeadBytes?: boolean },
): Promise<LocalSong> {
    if (song.localCoverAssetId && await hasLocalCoverBinary(song.localCoverAssetId)) return song;
    if (song.localCoverSource === 'folder') return song;

    if (!localCoverAssetRequestMap.has(song.id)) {
        localCoverAssetRequestMap.set(song.id, (async () => {
            const fileHandle = await getAccessibleFileHandle(song);
            if (!fileHandle) {
                // 安卓没有句柄，但字节还能从原生回环服务取回来 —— 别就这么放弃。
                const nativeFile = await nativeAudioFile(song, options?.preferHeadBytes === true);
                if (!nativeFile) return song;
                try {
                    return await extractAndPersistSongCover(song, null, nativeFile);
                } catch (error) {
                    console.warn(`[LocalMusic] Failed to ensure native embedded cover for ${song.fileName}:`, error);
                    return song;
                }
            }

            try {
                return await extractAndPersistSongCover(song, fileHandle);
            } catch (error) {
                console.warn(`[LocalMusic] Failed to ensure embedded cover for ${song.fileName}:`, error);
                fileHandleMap.delete(song.id);

                try {
                    const recoveredHandle = await recoverFileHandleFromPersistedDirectory(song);
                    if (!recoveredHandle) {
                        return song;
                    }

                    return await extractAndPersistSongCover(song, recoveredHandle);
                } catch (recoveryError) {
                    console.warn(`[LocalMusic] Failed to recover embedded cover for ${song.fileName}:`, recoveryError);
                    return song;
                }
            } finally {
                localCoverAssetRequestMap.delete(song.id);
            }
        })());
    }

    return await localCoverAssetRequestMap.get(song.id)!;
}
