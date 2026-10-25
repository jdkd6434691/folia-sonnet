import { startTransition, useEffect, useState } from 'react';
import { clearCacheByCategory, getCacheUsageByCategory } from '../../../services/db';
import { forgetSettledDrumHits } from '../../../services/analysis/drumHits';
import type { CacheCategory } from './pages/settingsPageContext';

// src/components/modal/settings/useCacheUsagePanel.ts
// 设置 → 存储里那一块缓存用量：各分类占多少、正在清哪一类、清理后重新量一遍。
// 从 SettingsModal 拆出来；缓存目录本身在主进程那一组里（useElectronSettingsPanel）。

export const useCacheUsagePanel = (activeTab: 'help' | 'options') => {
    // Cache State
    const [cacheSizes, setCacheSizes] = useState({
        playlist: '0 B',
        lyrics: '0 B',
        cover: '0 B',
        media: '0 B',
        analysis: '0 B'
    });
    const [mediaCount, setMediaCount] = useState(0);
    const [isCleaning, setIsCleaning] = useState<CacheCategory | null>(null);

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const applyCacheUsage = (usage: Awaited<ReturnType<typeof getCacheUsageByCategory>>) => {
        setCacheSizes({
            playlist: formatBytes(usage.playlist),
            lyrics: formatBytes(usage.lyrics),
            cover: formatBytes(usage.cover),
            media: formatBytes(usage.media),
            analysis: formatBytes(usage.analysis)
        });
        setMediaCount(usage.mediaCount);
    };

    const fetchCacheUsage = async () => {
        applyCacheUsage(await getCacheUsageByCategory());
    };

    useEffect(() => {
        if (activeTab === 'options') {
            // Like the answers above, it lands while the window is opening.
            void getCacheUsageByCategory().then(usage => startTransition(() => applyCacheUsage(usage)));
        }
    }, [activeTab]);

    const handleClear = async (category: CacheCategory) => {
        setIsCleaning(category);
        await clearCacheByCategory(category);
        // The drum hits' memory of which tracks are stored goes with the stored analyses.
        if (category === 'analysis') forgetSettledDrumHits();
        await fetchCacheUsage();
        setIsCleaning(null);
    };

    return { cacheSizes, mediaCount, isCleaning, clearCategory: handleClear };
};

export type CacheUsagePanel = ReturnType<typeof useCacheUsagePanel>;
