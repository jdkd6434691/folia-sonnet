import type { SongResult } from '../../../types';
import type { MediaId, OmniChorusRange, OmniLyricsResult } from '../../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { resolveProviderLyricsChorus } from '../../../utils/lyrics/chorusResolver';
import { applyOmniLyricsHook } from '../../hostExtensionHooks';
import { getOnlineMusicProviderForSong } from '../providerRegistry';
import { providerForSong, unsupported } from './providerCalls';

// src/services/onlineMusic/omni/lyricsMethods.ts
// A song's lyrics through its provider, with the extension hooks and the chorus marked.

export const lyricsMethods = {
    // `extensionHooks: false` answers the lyrics as the provider gave them, chorus marked, before any
    // extension layer rewrites them: a reader that is itself such a layer would otherwise call itself.
    async getLyrics(song: SongResult, context?: { userId?: MediaId | null; extensionHooks?: boolean }): Promise<OmniLyricsResult> {
        const provider = providerForSong(song);
        if (!provider.lyrics) return unsupported(provider.id, 'lyrics');
        const { extensionHooks = true, ...providerContext } = context ?? {};
        const providerUserId = useOnlineProviderAccountStore.getState().accounts[provider.id]?.user?.id ?? providerContext.userId;
        const providerResult = await provider.lyrics.getLyrics(song, { ...providerContext, userId: providerUserId });
        const resolved = (await resolveProviderLyricsChorus(providerResult, {
            providerId: provider.id,
            songId: song.id,
        })).result;
        if (!extensionHooks) return resolved;
        // Extension layers (Folium omni hooks) may rewrite the lyrics after the provider answered.
        return applyOmniLyricsHook(song, resolved);
    },

    async getChorusRanges(song: SongResult): Promise<OmniChorusRange[]> {
        const provider = providerForSong(song);
        return provider.lyrics?.getChorusRanges?.(song.id) ?? [];
    },

    // Another name the song's artist may be listed under elsewhere, when its provider knows one.
    async getAlternateArtistName(song: SongResult): Promise<string | null> {
        return await getOnlineMusicProviderForSong(song)?.lyrics?.getAlternateArtistName?.(song) ?? null;
    },
};
