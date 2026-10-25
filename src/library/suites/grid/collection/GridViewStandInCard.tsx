import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import { fullBleedScrim } from '../shared/PolaroidCard';
import { HEX_CARD_CENTER_SCALE } from '../shared/hexCardTransform';
import { CARD_TITLE_ATTR, MORPH_FRAME_ATTR, MORPH_TARGET_ATTR } from '../transitions/gridMorphContract';
import type { StandInCard as StandInState } from './useGridViewStandIn';

// src/library/suites/grid/collection/GridViewStandInCard.tsx
// 移形换影的替身卡（原 GridView.tsx 里那一块 motion.div 原样搬出）：位置、卡框、封面、标题与加载说明不变。

type GridViewStandInCardProps = {
    standIn: StandInState | null;
    standInCardRef: RefObject<HTMLDivElement | null>;
    fullBleedCover: boolean;
    cardWidth: number;
    cardHeight: number;
    isDaylight: boolean;
    showLoading: boolean;
    collectionName?: string;
    title: string;
};

export const GridViewStandInCard = ({
    standIn,
    standInCardRef,
    fullBleedCover,
    cardWidth,
    cardHeight,
    isDaylight,
    showLoading,
    collectionName,
    title,
}: GridViewStandInCardProps) => {
    const { t } = useTranslation();
    if (!standIn || standIn.gone) return null;

    return (
                    <motion.div
                        aria-hidden="true"
                        className="absolute left-1/2 top-1/2 z-[60] pointer-events-none"
                        style={{ x: '-50%', y: '-50%', scale: HEX_CARD_CENTER_SCALE, perspective: '1200px' }}
                    >
                        <div
                            ref={standInCardRef}
                            {...{ [MORPH_FRAME_ATTR]: '' }}
                            {...(fullBleedCover ? { [MORPH_TARGET_ATTR]: '' } : {})}
                            className={`relative rounded-xl border shadow-lg theme-polaroid-card ${fullBleedCover ? 'overflow-hidden' : 'p-3'}`}
                            style={{ width: cardWidth, [fullBleedCover ? 'height' : 'minHeight']: cardHeight }}
                        >
                            <div
                                {...(fullBleedCover ? {} : { [MORPH_TARGET_ATTR]: '' })}
                                className={fullBleedCover
                                    ? 'absolute inset-0 bg-zinc-200/60 dark:bg-zinc-800/60'
                                    : 'relative w-full aspect-square rounded-lg overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60 shadow-inner'}
                            >
                                {standIn.coverUrl && (
                                    <img src={standIn.coverUrl} alt="" draggable={false} decoding="sync" className="absolute inset-0 h-full w-full object-cover" />
                                )}
                            </div>
                            {fullBleedCover && <div className="absolute inset-0" style={{ backgroundImage: fullBleedScrim(isDaylight) }} />}
                            {/* The title that flies with the cover (the clicked card's; the
                                collection's own where that card has none), where a card's
                                title stands, and under it what the page is doing. */}
                            <div className={fullBleedCover ? 'absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 text-left' : 'pt-3 text-left'}>
                                <div
                                    {...{ [CARD_TITLE_ATTR]: '' }}
                                    className={fullBleedCover
                                        ? 'text-sm font-bold tracking-tight leading-snug line-clamp-3 whitespace-normal break-words'
                                        : 'text-s font-bold tracking-tight opacity-90 max-w-full line-clamp-4 whitespace-normal break-words'}
                                >
                                    {standIn.title ?? collectionName ?? title}
                                </div>
                                {showLoading && (
                                    <div className="mt-1 flex items-center gap-2 text-xs font-semibold font-sans opacity-60">
                                        <Loader2 className="animate-spin shrink-0" size={14} />
                                        <span className="truncate">{t('playlist.loading')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
            </motion.div>
    );
};

export default GridViewStandInCard;
