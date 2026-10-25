import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Disc, Eye, EyeOff, X } from 'lucide-react';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import { isHideableDirectoryItem } from '../../../core/directory/directoryVisibility';
import { resolveGridMapCardTitle, resolveGridMapFolderLabel } from './gridMapCardText';
import { Button } from '../../../../components/ui';
import type { GridMapItem } from './GridMap';

// src/library/suites/grid/directory/GridMapCard.tsx
// GridMap 的一张卡（原 GridMap.tsx 底部的 MapCard，原样搬出）：同一张 Polaroid 卡、同一份 memo 比较函数。

const compactDescription = (description?: string, maxLength = 72) => {
    if (!description) return '';
    const normalized = description.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.substring(0, maxLength)}...` : normalized;
};

/**
 * Renders a simplified polaroid-style card representing a collection.
 * Designed to be clicked to immediately select and center the item.
 */
export const MapCard = React.memo<{
    item: GridMapItem;
    isDaylight: boolean;
    onSelect: () => void;
    isPlaylistEditMode: boolean;
    isHidden: boolean;
    isBatchMode: boolean;
    isBatchSelected: boolean;
    onTogglePlaylistHidden?: () => void;
    cardWidth: number;
    cardHeight: number;
}>(
    ({
        item,
        isDaylight,
        onSelect,
        isPlaylistEditMode,
        isHidden,
        isBatchMode,
        isBatchSelected,
        onTogglePlaylistHidden,
        cardWidth,
        cardHeight,
    }) => {
        const { t } = useTranslation();
        const isPlaylistSelectionDisabled = isPlaylistEditMode && isHideableDirectoryItem(item);
        // 文件夹卡（含虚拟的「全部歌曲」）的标题、描述行数、「本目录 N 首」都按 folderLabel 判断，见 gridMapCardText。
        const folderLabel = resolveGridMapFolderLabel(item);
        const displayName = resolveGridMapCardTitle(item);

        return (
            <div
                className={`rounded-xl p-3 flex flex-col items-center border backdrop-blur-md transition-all duration-300 shadow-lg theme-polaroid-card ${
                    isPlaylistSelectionDisabled ? 'cursor-default' : 'cursor-pointer hover:shadow-2xl'
                } ${isBatchMode && !isBatchSelected ? 'opacity-35 grayscale' : ''}`}
                style={{
                    width: cardWidth,
                    minHeight: cardHeight,
                    height: 'auto',
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (!isPlaylistSelectionDisabled) onSelect();
                }}
            >
                {/* Square Polaroid Photo Area */}
                <div className="w-full aspect-square rounded-lg overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60 relative shadow-inner flex items-center justify-center shrink-0">
                    {item.coverUrl ? (
                        <>
                            <img
                                src={getSizedCoverUrl(item.coverUrl, 512)}
                                alt={displayName}
                                loading="lazy"
                                decoding="async"
                                ref={(el) => {
                                    if (el && el.complete) {
                                        el.style.opacity = '1';
                                        const placeholder = el.nextElementSibling as HTMLElement;
                                        if (placeholder) {
                                            placeholder.style.opacity = '0';
                                            placeholder.style.display = 'none';
                                        }
                                    }
                                }}
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    img.style.opacity = '1';
                                    const placeholder = img.nextElementSibling as HTMLElement;
                                    if (placeholder) {
                                        placeholder.style.opacity = '0';
                                        setTimeout(() => {
                                            placeholder.style.display = 'none';
                                        }, 350);
                                    }
                                }}
                                className="w-full h-full object-cover transition-opacity duration-350 pointer-events-none select-none opacity-0"
                            />
                            <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 transition-opacity duration-350 flex items-center justify-center">
                                <Disc size={48} className="opacity-20 animate-spin" style={{ animationDuration: '3s', color: 'var(--text-primary)' }} />
                            </div>
                        </>
                    ) : (
                        <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 flex items-center justify-center">
                            <Disc size={48} className="opacity-20" style={{ color: 'var(--text-primary)' }} />
                        </div>
                    )}
                    {isPlaylistEditMode && isHideableDirectoryItem(item) && onTogglePlaylistHidden && (
                        <Button
                            onClick={(event) => {
                                event.stopPropagation();
                                onTogglePlaylistHidden();
                            }}
                            className={`absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 shadow-lg backdrop-blur-md transition-transform hover:scale-105 active:scale-95 ${
                                isHidden ? 'bg-red-500/80 text-white' : 'bg-black/45 text-white'
                            }`}
                            tip={t(isHidden ? 'home.showPlaylist' : 'home.hidePlaylist')}
                        >
                            {isHidden ? <EyeOff size={17} /> : <Eye size={17} />}
                        </Button>
                    )}
                    {isBatchMode && (
                        <span className={`absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border shadow-lg backdrop-blur-md ${
                            isBatchSelected ? 'border-sky-300/50 bg-sky-500 text-white' : 'border-white/20 bg-black/45 text-white'
                        }`}>
                            {isBatchSelected ? <Check size={16} strokeWidth={3} /> : <X size={15} />}
                        </span>
                    )}
                </div>

                {/* Bottom Polaroid Frame Label Details */}
                <div className="w-full flex-1 flex flex-col justify-between pt-3 text-left min-w-0">
                    <div className="space-y-1 mb-2">
                        <div className="text-xs font-bold tracking-tight opacity-90 max-w-full line-clamp-2 whitespace-normal break-words">
                            {displayName}
                        </div>
                        {item.description && (
                            <div
                                className={`text-[10px] opacity-55 max-w-full font-medium whitespace-normal break-words ${folderLabel ? 'line-clamp-2' : 'line-clamp-1'}`}
                                title={folderLabel ? item.description : undefined}
                            >
                                {item.description}
                            </div>
                        )}
                        {compactDescription(item.summary) && (
                            <div className="text-[10px] leading-snug opacity-45 max-w-full font-medium line-clamp-2 whitespace-normal break-words">
                                {compactDescription(item.summary)}
                            </div>
                        )}
                        {folderLabel && typeof item.trackCount === 'number' && item.trackCount > 0 && (
                            <div className="text-[10px] leading-snug opacity-45 max-w-full font-medium">
                                {t('home.gridFolderDirectTrackCount', { count: item.trackCount })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    },
    (prev, next) => {
        return (
            prev.item.id === next.item.id &&
            prev.item.name === next.item.name &&
            prev.item.coverUrl === next.item.coverUrl &&
            prev.item.description === next.item.description &&
            prev.item.summary === next.item.summary &&
            prev.item.trackCount === next.item.trackCount &&
            prev.item.type === next.item.type &&
            prev.isDaylight === next.isDaylight &&
            prev.isPlaylistEditMode === next.isPlaylistEditMode &&
            prev.isHidden === next.isHidden &&
            prev.isBatchMode === next.isBatchMode &&
            prev.isBatchSelected === next.isBatchSelected &&
            prev.onTogglePlaylistHidden === next.onTogglePlaylistHidden &&
            prev.cardWidth === next.cardWidth &&
            prev.cardHeight === next.cardHeight &&
            prev.onSelect === next.onSelect
        );
    }
);
