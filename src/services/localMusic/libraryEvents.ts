import { announceLocalCoverReady } from '../localCoverReadyEvent';

// src/services/localMusic/libraryEvents.ts
// The window events a local-music change is told by, and the helpers that send them.

export const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';
export const LOCAL_MUSIC_SCAN_PROGRESS_EVENT = 'folia-local-music-scan-progress';

interface LocalMusicScanProgressDetail {
    active: boolean;
    folderName: string;
    totalSongs: number;
    completedSongs: number;
}

export function notifyLocalMusicUpdated() {
    window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_UPDATED_EVENT));
}

export function notifyLocalCoverReady(songId: string, assetId: string) {
    announceLocalCoverReady({ songId, assetId });
}

export function notifyLocalMusicScanProgress(detail: LocalMusicScanProgressDetail) {
    window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, { detail }));
}
