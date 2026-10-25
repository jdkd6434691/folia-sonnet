import type { LocalSong, LyricData } from '../../types';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { hasLocalSongCover } from '../../utils/localSongCover';
import { autoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyric';
import { buildLocalSongLyricMatchContext, shouldRefreshLocalSongLyricsFromMetadata } from '../../utils/lyrics/localSongMatchContext';
import { resolveLyricSourcePreference } from '../../utils/lyrics/lyricSourcePreference';
import { normalizeLyricMatchText } from '../../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../../utils/lyrics/searchQuery';
import { applyMatchedMetadata } from '../localLibraryCatalogService';
import { getLocalLibraryCatalogSnapshot } from '../localLibraryEntityRepository';
import { normalizeLyricMatchMetadataCandidate } from '../onlineMetadataSearchService';
import { getOnlineMusicProvider } from '../onlineMusic/providerRegistry';
import { getProviderSongMetadata } from '../onlineMusic/songMetadata';
import { resolveLocalSongMetadata } from '../playbackAdapters';

// src/services/localMusic/lyricsMatch.ts
// Matches a local song's lyrics through the configured sources, and settles the result on the song.

// Helper function to normalize title for comparison

function normalizeTitle(title: string): string {
    return normalizeLyricMatchText(title).replace(/\s+/g, '');
}

// Helper function to check if two titles match
function isTitleMatch(localTitle: string, searchTitle: string): boolean {
    const normalizedLocal = normalizeTitle(localTitle);
    const normalizedSearch = normalizeTitle(searchTitle);

    // Check for exact match first
    if (normalizedLocal === normalizedSearch) {
        return true;
    }

    // Check if either title contains the other (for fuzzy matching)
    // This helps when local file is "Title-Artist" but search result is just "Title"
    if (normalizedLocal.includes(normalizedSearch) || normalizedSearch.includes(normalizedLocal)) {
        // Additional check: the shorter one should be at least 50% of the longer one
        // to avoid matching "a" with "abc"
        const minLength = Math.min(normalizedLocal.length, normalizedSearch.length);
        const maxLength = Math.max(normalizedLocal.length, normalizedSearch.length);
        if (minLength / maxLength >= 0.5) {
            return true;
        }
    }

    return false;
}

// Match lyrics for a local song using search API, respecting the configured local/online priority.
export async function matchLyrics(song: LocalSong): Promise<LyricData | null> {
    // 用户标记的纯音乐不再自动匹配；与在线判定的纯音乐一样，连带的封面自动匹配也跳过。
    // 下面每次写回都带 skipIfMarkedPureMusic：匹配途中才标上的，写回时在事务里按库里的最新记录放弃。
    if (song.markedPureMusic || (song.matchedIsPureMusic && !shouldRefreshLocalSongLyricsFromMetadata(song))) {
        return null;
    }
    try {
        const catalog = await getLocalLibraryCatalogSnapshot();
        const resolvedMetadata = resolveLocalSongMetadata(song.id, catalog);
        const matchContext = buildLocalSongLyricMatchContext(song, {
            artistNames: resolvedMetadata.artists.map(artist => artist.name),
            albumName: resolvedMetadata.album?.name,
        });
        const searchQuery = buildLyricSearchQuery(matchContext.title, matchContext.artist, matchContext.album);
        const hasLocalOrEmbeddedLyrics = Boolean(
            (song.hasLocalLyrics && song.localLyricsContent)
            || (song.hasEmbeddedLyrics && song.embeddedLyricsContent)
        );
  const settingsLyricSettings = useLyricSettingsStore.getState();
        const onlineFirst = settingsLyricSettings.localLyricsPriority === 'online';

        console.log(`[LocalMusic] Searching lyrics for: "${searchQuery}"`);

        // A selected GridView metadata identity is authoritative and must not be replaced by lyric fallback metadata.
        if (!hasLocalOrEmbeddedLyrics || onlineFirst) {
            const shouldUseBestLyric = settingsLyricSettings.autoUseBestLyric;
            if (shouldUseBestLyric || matchContext.metadataCandidate) {
                const bestMatch = await autoMatchBestLyric(
                    matchContext.title,
                    matchContext.artist,
                    matchContext.durationMs,
                    {
                        album: matchContext.album,
                        // 本地文件没有平台来源，跟不了「跟随播放平台」，直接落到「本地歌曲的歌词来源」。
                        preferredSource: shouldUseBestLyric ? resolveLyricSourcePreference(settingsLyricSettings) : undefined,
                        metadataCandidate: matchContext.metadataCandidate,
                        exactMatchOnly: Boolean(matchContext.metadataCandidate && !shouldUseBestLyric),
                    },
                );

                if (bestMatch && 'isPureMusic' in bestMatch) {
                    song.matchedIsPureMusic = true;
                    song.matchedLyrics = undefined;
                    song.matchedLyricsSongId = bestMatch.id ?? matchContext.metadataCandidate?.songId;
                    song.matchedLyricsSource = bestMatch.source ?? matchContext.metadataCandidate?.source;
                    await applyMatchedMetadata(song.id, {}, { lyricsOnly: true, songPatch: song, skipIfMarkedPureMusic: true });
                    return null;
                }

                if (bestMatch && 'lyrics' in bestMatch) {
                    song.matchedLyricsSongId = bestMatch.id;
                    song.matchedLyricsSource = bestMatch.source;
                    song.matchedLyricsProviderPlatform = bestMatch.matchedLyricsProviderPlatform;
                    song.matchedLyrics = bestMatch.lyrics;
                    song.matchedIsPureMusic = false;

                    if (matchContext.metadataCandidate) {
                        await applyMatchedMetadata(song.id, {}, { lyricsOnly: true, songPatch: song, skipIfMarkedPureMusic: true });
                        return bestMatch.lyrics;
                    }

                    const matchedMetadata = normalizeLyricMatchMetadataCandidate(
                        bestMatch.source,
                        bestMatch.song,
                        {
                            title: matchContext.title,
                            artist: matchContext.artist,
                            album: matchContext.album,
                            durationMs: matchContext.durationMs,
                        },
                    );
                    const coverUrl = matchedMetadata.coverUrl;
                    await applyMatchedMetadata(song.id, {
                        source: matchedMetadata.source,
                        songId: matchedMetadata.songId,
                        title: matchedMetadata.title,
                        artists: matchedMetadata.artists,
                        album: matchedMetadata.album,
                        coverUrl,
                    }, {
                        songPatch: {
                            ...song,
                            useOnlineCover: Boolean(coverUrl && !hasLocalSongCover(song)),
                        },
                        protectOrigins: ['manual', 'manual-match', 'split'],
                        skipIfMarkedPureMusic: true,
                    });
                    return bestMatch.lyrics;
                }
            }
        } else if (matchContext.metadataCandidate) {
            return null;
        }

        // Search on Netease
        const searchPage = await getOnlineMusicProvider('netease')?.search?.searchSongs(searchQuery, 50, 0);

        if (!searchPage?.items?.length) {
            console.warn(`[LocalMusic] No search results for: "${searchQuery}"`);
            return null;
        }

        // Try to find a song with matching title
        const localTitle = matchContext.title;
        const matchedSong = searchPage.items.find(candidate => isTitleMatch(localTitle, candidate.name));

        // If no exact title match found, return null to trigger manual selection
        if (!matchedSong) {
            console.log(`[LocalMusic] No exact title match found for: "${localTitle}". Manual selection required.`);
            return null;
        }

        const matchedMetadata = getProviderSongMetadata(matchedSong, 'netease');
        console.log(`[LocalMusic] Found exact title match: ${matchedSong.name} by ${matchedMetadata.artists.map(artist => artist.name).join(', ')}`);

        // Preserve local and embedded lyrics when the configured priority keeps them first.
        if (!onlineFirst && ((song.hasLocalLyrics && song.localLyricsContent) || (song.hasEmbeddedLyrics && song.embeddedLyricsContent))) {
            console.log(`[LocalMusic] Local/embedded lyrics exist, skipping online lyrics fetch. Only fetching cover/metadata.`);

            // Only update metadata and cover, preserve local lyrics
            const coverUrl = matchedMetadata.coverUrl;
            await applyMatchedMetadata(song.id, {
                source: 'netease',
                songId: matchedSong.id,
                title: matchedSong.name,
                artists: matchedMetadata.artists,
                album: matchedMetadata.album,
                coverUrl: coverUrl?.replace('http:', 'https:'),
            }, {
                songPatch: { ...song, useOnlineCover: Boolean(coverUrl && !hasLocalSongCover(song)) },
                protectOrigins: ['manual', 'manual-match', 'split'],
                skipIfMarkedPureMusic: true,
            });

            // Return null to indicate no NEW lyrics were fetched (local lyrics are used)
            return null;
        }

        // Fetch lyrics (only when NO local lyrics)
        const processed = await getOnlineMusicProvider('netease')?.lyrics?.getLyrics(matchedSong);
        if (!processed) return null;

        song.matchedLyricsSongId = matchedSong.id;
        song.matchedLyricsSource = 'netease';
        song.matchedLyrics = processed.lyrics || undefined;
        song.matchedIsPureMusic = processed.isPureMusic;

        if (matchContext.metadataCandidate) {
            await applyMatchedMetadata(song.id, {}, { lyricsOnly: true, songPatch: song, skipIfMarkedPureMusic: true });
            return processed.lyrics;
        }

        const coverUrl = matchedMetadata.coverUrl;
        await applyMatchedMetadata(song.id, {
            source: 'netease',
            songId: matchedSong.id,
            title: matchedSong.name,
            artists: matchedMetadata.artists,
            album: matchedMetadata.album,
            coverUrl: coverUrl?.replace('http:', 'https:'),
        }, {
            songPatch: { ...song, useOnlineCover: Boolean(coverUrl && !hasLocalSongCover(song)) },
            protectOrigins: ['manual', 'manual-match', 'split'],
            skipIfMarkedPureMusic: true,
        });
        return processed.lyrics;
    } catch (error) {
        console.error('[LocalMusic] Failed to match lyrics:', error);
        return null;
    }
}
