import { getSizedCoverUrl } from '../../../../utils/coverUrl';

// src/library/suites/grid/collection/gridViewText.ts
// GridView 的封面地址与文本格式化：原 GridView.tsx 顶部的四个纯函数，原样搬出（面板组件也用同一份）。

export const getLowResCoverUrl = (url: string): string => getSizedCoverUrl(url, 150);

export const toHttps = (url?: string): string => {
    if (!url) return '';
    if (
        url.startsWith('http:') &&
        !url.includes('/rest/') &&
        !url.includes('localhost') &&
        !url.includes('127.0.0.1') &&
        !url.includes('192.168.') &&
        !url.includes('10.') &&
        !url.includes('172.')
    ) {
        return url.replace('http:', 'https:');
    }
    return url;
};

export const formatAlbumDate = (timestamp?: number) => {
    if (!timestamp || !Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString();
};

export const formatAlbumDuration = (duration?: number) => {
    if (!duration || !Number.isFinite(duration)) return '';
    const totalSeconds = duration > 10000 ? Math.round(duration / 1000) : Math.round(duration);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

