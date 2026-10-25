import React, { useMemo } from 'react';
import type { MotionValue } from 'framer-motion';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { SongResult, Theme } from '../../../../types';
import type { LibraryArtistDetail } from '../../../core/artist/artist.contract';
import type { ArtistView } from '../../../core/artist/useArtistView';
import { PolaroidCard } from '../shared/PolaroidCard';
import { HEX_CARD_CENTER_SCALE } from '../shared/hexCardTransform';
import type { GridPlaybackMark } from '../shared/useGridStayPlayback';
import type { HexGridCoord } from '../shared/hexViewport';
import {
    ARTIST_INTRO_ATTR,
    ARTIST_INTRO_VALUE_AVATAR,
    ARTIST_INTRO_VALUE_BIO,
    GRID_CARD_ITEM_ID_ATTR,
    MORPH_TARGET_ATTR,
} from '../transitions/gridMorphContract';
import { collectionMorphFlyIn, collectionMorphSeed, type CollectionMorphPlan } from '../transitions/morphGeometry';
import { ArtistPicture } from './ArtistPicture';
import type { GridItem, resolveArtistGridCardBox } from './artistGridLayout';

// src/library/suites/grid/artist/ArtistGridCards.tsx
// 歌手页画出来的那些卡：头像、简介与热门歌曲 / 专辑的相纸卡。位置与缩放在 ArtistGridView 的 rAF 循环里
// 直接写卡片外层（cardWrapperRefs），这里只管每张卡自己的内容与入场动画。

type ArtistGridCardBox = ReturnType<typeof resolveArtistGridCardBox>;

interface ArtistGridCardsProps {
    drawnIndexes: number[];
    gridItems: GridItem[];
    baseCoords: HexGridCoord[];
    layoutConfig: ArtistGridCardBox;
    clipRadius: number;
    minCardScale: number;
    minCardOpacity: number;
    isDaylight: boolean;
    theme: Theme;
    fullBleedCover: boolean;
    focusedIndex: number;
    artistInfo: LibraryArtistDetail | null;
    artistActions: ArtistView['actions'];
    markFor: (track: SongResult | undefined) => GridPlaybackMark | null;
    canPlaySong: boolean;
    canEnqueueSong: boolean;
    canOpenAlbum: boolean;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    handleSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    handleSelectAlbumLink?: (albumId: number | string, album?: any, track?: SongResult) => void;
    persistNavigationState: (index: number) => void;
    shouldAnimateItemEntrance: (itemKey: string) => boolean;
    entrance: CollectionMorphPlan | null;
    isComingUp: boolean;
    reducedMotion: boolean;
    artistPicture: string | null;
    isLandingPlace: boolean;
    morphFlyInReach: number;
    dragX: MotionValue<number>;
    dragY: MotionValue<number>;
    centerOnIndex: (index: number, snap?: boolean) => void;
    isDraggingRef: React.MutableRefObject<boolean>;
    setShowFullBio: React.Dispatch<React.SetStateAction<boolean>>;
    cardWrapperRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
    cardBg: string;
}

export const ArtistGridCards: React.FC<ArtistGridCardsProps> = ({
    drawnIndexes,
    gridItems,
    baseCoords,
    layoutConfig,
    clipRadius,
    minCardScale,
    minCardOpacity,
    isDaylight,
    theme,
    fullBleedCover,
    focusedIndex,
    artistInfo,
    artistActions,
    markFor,
    canPlaySong,
    canEnqueueSong,
    canOpenAlbum,
    onSelectAlbum,
    handleSelectArtist,
    handleSelectAlbumLink,
    persistNavigationState,
    shouldAnimateItemEntrance,
    entrance,
    isComingUp,
    reducedMotion,
    artistPicture,
    isLandingPlace,
    morphFlyInReach,
    dragX,
    dragY,
    centerOnIndex,
    isDraggingRef,
    setShowFullBio,
    cardWrapperRefs,
    cardBg,
}) => {
    const { t } = useTranslation();
    const renderedCards = useMemo(() => {
        return drawnIndexes.map((idx) => {
            const item = gridItems[idx];
            const coord = baseCoords[idx];
            if (!item || !coord) return null;

            const initialDx = dragX.get();
            const initialDy = dragY.get();
            const initialCenterX = coord.baseX + initialDx;
            const initialCenterY = coord.baseY + initialDy;
            const initialDist = Math.sqrt(initialCenterX * initialCenterX + initialCenterY * initialCenterY);
            const initialT = Math.min(initialDist / layoutConfig.maxDistance, 1);
            const initialScale = HEX_CARD_CENTER_SCALE - (HEX_CARD_CENTER_SCALE - minCardScale) * initialT;
            const initialOpacity = 1.0 - (1.0 - minCardOpacity) * initialT;
            const initialZ = Math.round(50 - 49 * initialT);

            // Index 0: Circular Avatar Card (No label details, pure image visual)
            if (idx === 0) {
                return (
                    <div
                        key={`avatar-${idx}`}
                        ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                        {...{ [ARTIST_INTRO_ATTR]: ARTIST_INTRO_VALUE_AVATAR }}
                        className="absolute select-none pointer-events-auto"
                        style={{
                            transformOrigin: 'center center',
                            willChange: 'transform, opacity',
                            display: initialDist > clipRadius ? 'none' : undefined,
                            transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                            opacity: initialDist > clipRadius ? 0 : initialOpacity,
                            zIndex: initialZ,
                        }}
                    >
                        {/* Where the cover of the clicked card lands. It stands at its
                            place and size from the page's first render (no entrance of
                            its own): the overlay measures it then, and hides it until the
                            cover has landed on it. */}
                        <div
                            {...(isLandingPlace ? { [MORPH_TARGET_ATTR]: '' } : {})}
                            className="rounded-full overflow-hidden shadow-2xl border-4 border-white/10 relative shrink-0"
                            style={{
                                width: layoutConfig.avatarSize || 240,
                                height: layoutConfig.avatarSize || 240,
                                backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                            }}
                        >
                            <ArtistPicture url={artistPicture} instant={reducedMotion} />
                        </div>
                    </div>
                );
            }

            // Index 1: Editorial Newspaper Biography Card
            if (idx === 1) {
                const totalTracksText = artistInfo?.trackCount ? `${artistInfo.trackCount} ${t('home.songs') || 'songs'}` : '';
                const totalAlbumsText = artistInfo?.albumCount ? `${artistInfo.albumCount} ${t('home.albums') || 'albums'}` : '';
                const statsLine = [totalTracksText, totalAlbumsText].filter(Boolean).join(' • ');

                return (
                    <div
                        key={`bio-${idx}`}
                        ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                        // Part of the intro cluster, not a morphable card: it has
                        // no cover and no card title, so it is excluded from both
                        // the capture source and the reverse flight's scatter
                        // (it used to fly out as a blank frame).
                        {...{ [ARTIST_INTRO_ATTR]: ARTIST_INTRO_VALUE_BIO }}
                        className="absolute select-none pointer-events-auto"
                        style={{
                            transformOrigin: 'center center',
                            willChange: 'transform, opacity',
                            display: initialDist > clipRadius ? 'none' : undefined,
                            transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                            opacity: initialDist > clipRadius ? 0 : initialOpacity,
                            zIndex: initialZ + 5,
                        }}
                    >
                        {/* Fades in beside the picture, which was there before it. */}
                        <motion.div
                            initial={isComingUp && !reducedMotion ? { opacity: 0, scale: 0.985 } : false}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                                opacity: { delay: 0.12, duration: 0.3, ease: 'easeOut' },
                                // 尺度收势走 Apple 惯用的那条 ease，比透明度稍长一点，
                                // 落定时才「稳」下来。
                                scale: { delay: 0.12, duration: 0.42, ease: [0.32, 0.72, 0, 1] },
                            }}
                        >
                            <div
                                onClick={() => {
                                    if (isDraggingRef.current) return;
                                    if (focusedIndex !== 1) {
                                        centerOnIndex(1, true);
                                    } else {
                                        setShowFullBio(true);
                                    }
                                }}
                                className={`rounded-3xl p-6 flex flex-col justify-between shadow-2xl backdrop-blur-xl transition-shadow cursor-pointer select-none text-left ${cardBg}`}
                                style={{
                                    width: layoutConfig.bioWidth || 460,
                                    height: layoutConfig.bioHeight || 250,
                                }}
                            >
                                <div className="space-y-2 min-w-0">
                                    <h1
                                        className="text-3xl font-extrabold tracking-tight truncate"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {item.name}
                                    </h1>
                                    {item.subtitle && (
                                        <p className="text-xs opacity-50 font-medium truncate">
                                            {item.subtitle}
                                        </p>
                                    )}
                                    <div className="w-12 h-0.5 bg-sky-400 opacity-60 rounded-full mt-1"></div>
                                </div>

                                <div className="flex-1 overflow-hidden mt-3 mb-2">
                                    <p className="text-xs opacity-65 leading-relaxed break-words whitespace-pre-wrap">
                                        {item.description || t('options.noDescription')}
                                    </p>
                                </div>

                                <div className="flex items-center border-t border-white/5 pt-3 mt-1 shrink-0">
                                    <div className="text-[10px] opacity-40 font-semibold">{statsLine}</div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                );
            }

            // Index 2..: Song & Album Polaroid cards
            const isSongCard = !!item.rawTrack;
            const cardMode = isSongCard ? 'tracks' : 'collection';
            const animateEntrance = shouldAnimateItemEntrance(String(item.id));
            // 「移形换影」fly-in: every non-intro card arrives from outside the
            // viewport along its radial from the avatar cluster, staggered with
            // an ease-out distance curve plus a deterministic jitter.
            // 屏外的卡不参与入场：渲染环带缓冲，那些卡看不见，却要各付一次动画。
            const cardOnScreen = initialDist <= clipRadius;
            const isMorphFlyIn = Boolean(entrance && idx >= 2 && cardOnScreen);
            const morphFlyIn = isMorphFlyIn
                ? collectionMorphFlyIn(
                    { x: coord.baseX, y: coord.baseY },
                    { x: baseCoords[0].baseX, y: baseCoords[0].baseY },
                    layoutConfig.spacingX || 1,
                    morphFlyInReach,
                    collectionMorphSeed(String(item.id)),
                )
                : null;

            return (
                <div
                    key={`${cardMode}-${idx}-${item.id}`}
                    ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                    // Morph capture source (nested artist/album pushes) and
                    // squad-scatter member on back-out.
                    {...{ [GRID_CARD_ITEM_ID_ATTR]: String(item.id) }}
                    className="absolute select-none pointer-events-auto"
                    style={{
                        transformOrigin: 'center center',
                        willChange: 'transform, opacity',
                        display: initialDist > clipRadius ? 'none' : undefined,
                        transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                        opacity: initialDist > clipRadius ? 0 : initialOpacity,
                        zIndex: initialZ,
                    }}
                >
                    <motion.div
                        initial={isMorphFlyIn
                            ? { opacity: 0, x: morphFlyIn!.x, y: morphFlyIn!.y, scale: 0.94 }
                            : animateEntrance ? { opacity: 0, scale: 0.96 } : false}
                        animate={{
                            // Key set identical across branches so a plan
                            // expiring mid-flight can never freeze a card at
                            // its crooked in-between angle.
                            opacity: 1,
                            x: 0,
                            y: 0,
                            scale: 1,
                            rotate: 0,
                        }}
                        transition={isMorphFlyIn
                            // 一条 Apple 的 ease 补间而不是每张卡一条 spring：观感上整片网格
                            // 一起落定，成本上每帧只做插值（大页面同时有几十条动画在跑）。
                            ? { duration: 0.5, ease: [0.32, 0.72, 0, 1], delay: morphFlyIn!.delay }
                            : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    >
                    <PolaroidCard
                        item={item}
                        isDaylight={isDaylight}
                        theme={theme}
                        mode={cardMode}
                        t={t}
                        cardWidth={layoutConfig.cardWidth}
                        cardHeight={layoutConfig.cardHeight}
                        fullBleedCover={fullBleedCover}
                        openWhenFocusedOnCardClick={!isSongCard}
                        isFocused={focusedIndex === idx}
                        onSelect={() => {
                            if (isSongCard && canPlaySong && item.rawTrack) {
                                persistNavigationState(idx);
                                artistActions.playSong(item.rawTrack);
                            } else if (!isSongCard && onSelectAlbum && canOpenAlbum && item.rawCollection) {
                                persistNavigationState(idx);
                                onSelectAlbum(item.rawCollection.id, item.rawCollection);
                            }
                        }}
                        onCenter={() => {
                            if (isDraggingRef.current) return;
                            centerOnIndex(idx, true);
                        }}
                        onSelectArtist={handleSelectArtist}
                        onSelectAlbum={handleSelectAlbumLink}
                        onAddQueue={() => {
                            if (isSongCard && canEnqueueSong && item.rawTrack) {
                                artistActions.enqueueSong(item.rawTrack);
                            }
                        }}
                        playbackMark={isSongCard ? markFor(item.rawTrack) : null}
                    />
                    </motion.div>
                </div>
            );
        });
    }, [
        drawnIndexes,
        gridItems,
        baseCoords,
        isDaylight,
        theme,
        t,
        layoutConfig.cardWidth,
        layoutConfig.cardHeight,
        layoutConfig.maxDistance,
        clipRadius,
        fullBleedCover,
        minCardOpacity,
        minCardScale,
        focusedIndex,
        artistInfo,
        artistActions,
        markFor,
        canPlaySong,
        canEnqueueSong,
        canOpenAlbum,
        onSelectAlbum,
        handleSelectArtist,
        handleSelectAlbumLink,
        persistNavigationState,
        shouldAnimateItemEntrance,
        entrance,
        isComingUp,
        reducedMotion,
        artistPicture,
        isLandingPlace,
        morphFlyInReach,
    ]);
    return <>{renderedCards}</>;
};
