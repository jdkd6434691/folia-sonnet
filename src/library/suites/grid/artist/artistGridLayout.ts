import type React from 'react';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import type { SongResult } from '../../../../types';
import { artistAlbumEntryKey, artistSongEntryKey } from '../../../core/artist/artistSurface';
import type { CubeCoord, HexGridCoord } from '../shared/hexViewport';

// src/library/suites/grid/artist/artistGridLayout.ts
// 歌手页的纯部分：网格项、持久化记录、六边形坐标与各断点的卡片尺寸。页面组件只画，不再自己算这些。

export interface GridItem {
    id: string | number;
    name: React.ReactNode;
    coverUrl?: string;
    subtitle?: string;
    description?: string;
    rawTrack?: SongResult;
    rawTrackIndex?: number;
    rawCollection?: any;
}

/** 网格自己的布局记录：相机位置与当时焦点卡的下标（语义焦点在浏览会话里）。 */
export type StoredArtistGridNavigationState = {
    focusedIndex: number;
    dragX: number;
    dragY: number;
};

/** 挂载时定下的恢复目标：会话里的条目键优先，其次是布局记录里的下标；相机位置只在两者指向同一张卡时沿用。 */
export type ArtistGridRestoreTarget = {
    entryKey: string | null;
    stored: StoredArtistGridNavigationState | null;
};

export const ARTIST_GRID_STATE_STORAGE_PREFIX = 'folia_artist_grid_state:v2:';

export const artistGridStateStorageKey = (sessionKey: string): string => `${ARTIST_GRID_STATE_STORAGE_PREFIX}${sessionKey}`;

export const readStoredArtistGridState = (storageKey: string): StoredArtistGridNavigationState | null => {
    try {
        const saved = sessionStorage.getItem(storageKey);
        if (!saved) return null;
        const parsed = JSON.parse(saved) as Partial<StoredArtistGridNavigationState>;
        return {
            focusedIndex: Number.isFinite(parsed.focusedIndex) ? Number(parsed.focusedIndex) : 1,
            dragX: Number.isFinite(parsed.dragX) ? Number(parsed.dragX) : NaN,
            dragY: Number.isFinite(parsed.dragY) ? Number(parsed.dragY) : NaN,
        };
    } catch {
        sessionStorage.removeItem(storageKey);
        return null;
    }
};

/**
 * What is put on the page within this long of `loading` ending comes in with the page (the cards
 * settle in, as a cover that flew here lands). What comes later (more albums, cards dragged into
 * view) is put there as it always was.
 */
export const COMES_UP_FOR_MS = 600;
/** The round picture alone: what is drawn before the viewport has said which cards to draw. */
export const PICTURE_ONLY = [0];

/** 网格项在浏览会话里的条目键（头像与简介卡没有）。 */
export const gridItemEntryKey = (item: GridItem | undefined): string | null => {
    if (!item) return null;
    if (item.rawTrack) return artistSongEntryKey(item.rawTrack);
    if (item.rawCollection) return artistAlbumEntryKey(item.rawCollection);
    return null;
};

// Custom coordinate generator for Artist Grid
// Computes baseX/baseY for hexagons, reserving specific spots for Avatar and Bio.
// Popular songs are placed in the upper half (z <= -1) and albums are placed in the lower half (z >= 1).
export const buildArtistGridCoords = (
    songCount: number,
    albumCount: number,
    spacingX: number,
    spacingY: number
): HexGridCoord[] => {
    const coords: HexGridCoord[] = [];

    // Keep the avatar and biography visually grouped around the grid origin.
    coords.push({
        index: 0,
        cube: { x: -1, y: 1, z: 0 },
        baseX: -spacingX * 0.95,
        baseY: 0,
    });

    // Index 1: Biography Card
    coords.push({
        index: 1,
        cube: { x: 0, y: 0, z: 0 },
        baseX: spacingX * 0.65,
        baseY: 0,
    });

    // Generate candidates for the upper half (songs: z <= -1)
    const upperCandidates: { cube: CubeCoord; baseX: number; baseY: number; distSq: number; }[] = [];
    for (let z = -1; z >= -10; z--) {
        for (let x = -20; x <= 20; x++) {
            const y = -x - z;
            const baseX = x * spacingX + (z * spacingX) / 2;
            const baseY = z * spacingY;
            const distSq = baseX * baseX + baseY * baseY;
            upperCandidates.push({
                cube: { x, y, z },
                baseX,
                baseY,
                distSq,
            });
        }
    }
    // Sort upper candidates by distance to center to pack them tightly
    upperCandidates.sort((a, b) => a.distSq - b.distSq);

    // Assign upper candidates to popular songs (indices 2 .. 2 + songCount - 1)
    for (let i = 0; i < songCount; i++) {
        const candidate = upperCandidates[i];
        coords.push({
            index: 2 + i,
            cube: candidate.cube,
            baseX: candidate.baseX,
            baseY: candidate.baseY,
        });
    }

    // Generate candidates for the lower half (albums: z >= 1)
    const lowerCandidates: { cube: CubeCoord; baseX: number; baseY: number; distSq: number; }[] = [];
    const maxZ = Math.max(10, Math.floor(albumCount / 2) + 5);
    for (let z = 1; z <= maxZ; z++) {
        for (let x = -20; x <= 20; x++) {
            const y = -x - z;
            const baseX = x * spacingX + (z * spacingX) / 2;
            const baseY = z * spacingY;
            const distSq = baseX * baseX + baseY * baseY;
            lowerCandidates.push({
                cube: { x, y, z },
                baseX,
                baseY,
                distSq,
            });
        }
    }
    // Sort lower candidates by distance to center
    lowerCandidates.sort((a, b) => a.distSq - b.distSq);

    // Assign lower candidates to albums (indices starting after songs)
    const startIndex = 2 + songCount;
    for (let i = 0; i < albumCount; i++) {
        const candidate = lowerCandidates[i];
        coords.push({
            index: startIndex + i,
            cube: candidate.cube,
            baseX: candidate.baseX,
            baseY: candidate.baseY,
        });
    }

    return coords;
};

export const getLowResCoverUrl = (url: string): string => getSizedCoverUrl(url, 150);

// Card box, hex spacing and the sizes of the artist wall's own avatar and bio cards, per
// container-width breakpoint. Lifted out of the component so the memo shows only the choice
// between the plain box and the squared one.
export const resolveArtistGridCardBox = (width: number) => {
    if (width < 768) {
        // Mobile/Narrow
        return {
            cardWidth: 180,
            cardHeight: 280,
            spacingX: 205,
            spacingY: 270,
            maxDistance: 420,
            lodStart: 280,
            lodEnd: 320,
            avatarSize: 200,
            bioWidth: 360,
            bioHeight: 200,
        };
    } else if (width < 1440) {
        // Desktop
        return {
            cardWidth: 220,
            cardHeight: 330,
            spacingX: 250,
            spacingY: 320,
            maxDistance: 500,
            lodStart: 340,
            lodEnd: 385,
            avatarSize: 280,
            bioWidth: 480,
            bioHeight: 260,
        };
    } else if (width < 2000) {
        // Large Desktop
        return {
            cardWidth: 250,
            cardHeight: 375,
            spacingX: 285,
            spacingY: 365,
            maxDistance: 580,
            lodStart: 400,
            lodEnd: 450,
            avatarSize: 320,
            bioWidth: 540,
            bioHeight: 280,
        };
    } else {
        // Ultra Desktop
        return {
            cardWidth: 280,
            cardHeight: 420,
            spacingX: 320,
            spacingY: 410,
            maxDistance: 660,
            lodStart: 450,
            lodEnd: 510,
            avatarSize: 360,
            bioWidth: 600,
            bioHeight: 300,
        };
    }
};
