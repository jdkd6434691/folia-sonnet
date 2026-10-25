import React from 'react';
import { motion } from 'framer-motion';
import { Disc, Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import { formatSongName } from '../../../utils/songNameFormatter';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { getSongUnavailableLabel, isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';
import { Button } from '@/components/ui';

// src/components/app/search/SearchResultRow.tsx

type SearchResultRowProps = {
    track: UnifiedSong;
    style?: React.CSSProperties;
    /**
     * 这一行是新插进来的（「全部」流式搜索时另一家平台刚回来）。
     *
     * 由 SearchResultsList 在挂载那一刻钉住，之后一直是个常量：行被挤到别的位置不会重播。
     */
    entering?: boolean;
    isDaylight: boolean;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
};

const formatDuration = (duration: number) => {
    const totalSeconds = Math.max(0, Math.round(duration / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const SearchResultRow: React.FC<SearchResultRowProps> = ({
    track,
    style,
    entering = false,
    isDaylight,
    onPlayTrack,
    onAddTrackToQueue,
    onOpenArtist,
    onOpenAlbum,
}) => {
    const { t } = useTranslation();
    const isUnavailable = isSongUnavailable(track);
    const unavailableLabel = getSongUnavailableLabel(track, t('status.songUnavailableTag'));
    const metadata = getProviderSongMetadata(track);
    const coverUrl = getSizedCoverUrl(metadata.coverUrl, 120);
    const artists = metadata.artists;
    const album = metadata.album;
    const canOpenAlbum = Boolean(album?.name && (
        track.isLocal ? album.entityId
            : track.isNavidrome ? track.navidromeData?.albumId
                : canResolveSongCatalogRef(track, 'album', album)
    ));

    return (
        <div style={style} className="h-full px-2 py-1.5">
            {/*
                入场动画挂在这一层（卡片本身），不动外面那一层：
                外面那层的 `transform` 是 react-window 用来定位的，写进去会把行挪飞。
                让位时的滑动是 SearchResultsList 给它加的 transform 过渡，也不是这里的活。
            */}
            <motion.div
                initial={entering ? { opacity: 0, y: 10 } : false}
                /*
                 * 不可用那 55% 只能写在这儿：framer 动完就把 opacity 落在行内 style 上，
                 * 类名里的 opacity-55 会被它盖掉。
                 */
                animate={{ opacity: isUnavailable ? 0.55 : 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={`group flex h-full items-center gap-3 rounded-2xl border px-3 transition-colors ${
                    isDaylight
                        ? 'border-black/[0.05] bg-black/[0.035] hover:bg-black/[0.07]'
                        : 'border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08]'
                }`}
            >
                <Button
                    disabled={isUnavailable}
                    onClick={() => onPlayTrack(track)}
                    className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-500/15 disabled:cursor-not-allowed"
                    aria-label={t('search.playTrack')}
                >
                    {coverUrl ? (
                        <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center opacity-30">
                            <Disc size={22} />
                        </span>
                    )}
                    {!isUnavailable && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <Play size={18} fill="currentColor" />
                        </span>
                    )}
                </Button>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Button
                            disabled={isUnavailable}
                            onClick={() => onPlayTrack(track)}
                            className="truncate text-left text-sm font-semibold disabled:cursor-not-allowed"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {formatSongName(track)}
                        </Button>
                        {isUnavailable && (
                            <span className="shrink-0 rounded-full border border-current/10 px-2 py-0.5 text-[10px] opacity-60">
                    {unavailableLabel}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span className="min-w-0 truncate">
                            {artists.map((artist, index) => {
                                const canOpenArtist = Boolean(
                                    track.isLocal ? artist.entityId
                                        : track.isNavidrome ? track.navidromeData?.artistId
                                            : canResolveSongCatalogRef(track, 'artist', artist)
                                );
                                return (
                                    <React.Fragment key={`${artist.entityId || artist.id}-${index}`}>
                                        {index > 0 && ', '}
                                        <Button
                                            disabled={!canOpenArtist}
                                            onClick={() => onOpenArtist(track, artist.name, artist.id, artist.entityId)}
                                            className="enabled:hover:underline disabled:cursor-default"
                                        >
                                            {artist.name}
                                        </Button>
                                    </React.Fragment>
                                );
                            })}
                        </span>
                        {album?.name && (
                            <>
                                <span className="shrink-0 opacity-40">•</span>
                                <Button
                                    disabled={!canOpenAlbum}
                                    onClick={() => onOpenAlbum(track, album.name, album.id, album.entityId)}
                                    className="max-w-[45%] truncate text-left enabled:hover:underline disabled:cursor-default"
                                >
                                    {album.name}
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                <span className="hidden shrink-0 font-mono text-xs opacity-35 sm:block">
                    {formatDuration(metadata.durationMs)}
                </span>
                {!isUnavailable && (
                    <Button
                        onClick={() => onAddTrackToQueue(track)}
                        className="shrink-0 rounded-full p-2 opacity-60 transition-all hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label={t('navidrome.addToQueue')}
                        tip={t('navidrome.addToQueue')}
                    >
                        <Plus size={16} />
                    </Button>
                )}
            </motion.div>
        </div>
    );
};

export default React.memo(SearchResultRow);
