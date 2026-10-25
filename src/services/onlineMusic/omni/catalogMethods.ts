import type { SongResult, UnifiedSong } from '../../../types';
import type {
    OmniCollection,
    OmniPage,
    ProviderCatalogEntityKind,
    ProviderSongCatalogRefs,
} from '../../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { resolveSongCatalogRefSet } from '../catalogRefs';
import { getOnlineMusicProvider, providerSupports } from '../providerRegistry';
import { emptyPage, providerForCollection, providerForSong, runRequest } from './providerCalls';
import type { PageInput } from './providerCalls';

// src/services/onlineMusic/omni/catalogMethods.ts
// What a collection or an artist opens as at its provider: pages of songs and albums, details,
// catalog refs and page URLs.

export const catalogMethods = {
    async getCollectionTracks(collection: OmniCollection, page: PageInput): Promise<OmniPage<UnifiedSong>> {
        const provider = providerForCollection(collection);
        return runRequest(provider, 'collection', async () => {
            if (collection.type === 'album') {
                return await (provider.catalog?.getAlbumTracks?.(collection.id, page.limit, page.offset, collection) ?? emptyPage(page.offset));
            }
            if (collection.type === 'cloud') {
                return await (provider.catalog?.getCloudTracks?.(page.limit, page.offset, collection) ?? emptyPage(page.offset));
            }
            return await (provider.catalog?.getPlaylistTracks?.(collection.id, page.limit, page.offset, collection) ?? emptyPage(page.offset));
        });
    },

    async getAlbumDetail(collection: OmniCollection): Promise<OmniCollection | null> {
        return providerForCollection(collection).catalog?.getAlbumDetail?.(collection.id, collection) ?? null;
    },

    async getCollectionDetail(collection: OmniCollection): Promise<OmniCollection | null> {
        const catalog = providerForCollection(collection).catalog;
        if (collection.type === 'album') return catalog?.getAlbumDetail?.(collection.id, collection) ?? collection;
        if (collection.type === 'playlist') return catalog?.getPlaylistDetail?.(collection.id, collection) ?? collection;
        return collection;
    },

    async getArtistDetail(collection: OmniCollection): Promise<OmniCollection | null> {
        return providerForCollection(collection).catalog?.getArtistDetail?.(collection.id) ?? null;
    },

    async getArtistSongs(collection: OmniCollection, page: PageInput): Promise<OmniPage<UnifiedSong>> {
        return providerForCollection(collection).catalog?.getArtistSongs?.(collection.id, page.limit, page.offset) ?? emptyPage(page.offset);
    },

    async getArtistAlbums(collection: OmniCollection, page: PageInput): Promise<OmniPage<OmniCollection>> {
        return providerForCollection(collection).catalog?.getArtistAlbums?.(collection.id, page.limit, page.offset) ?? emptyPage(page.offset);
    },

    async getSubscriptionStatus(collection: OmniCollection): Promise<boolean> {
        const type = collection.type === 'album' ? 'album' : 'playlist';
        return providerForCollection(collection).catalog?.getSubscriptionStatus?.(type, collection.id, collection) ?? false;
    },

    canResolveCatalogRef(song: UnifiedSong, _kind: ProviderCatalogEntityKind): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const catalog = getOnlineMusicProvider(source.providerId)?.catalog;
        return Boolean(catalog?.resolveSongCatalogRefs || catalog?.canResolveSongCatalogRefs?.(song));
    },

    async resolveCatalogRefs(song: UnifiedSong): Promise<UnifiedSong> {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return song;
        return getOnlineMusicProvider(source.providerId)?.catalog?.resolveSongCatalogRefs?.(song) ?? song;
    },

    // The catalog refs a song's album and artists open as at its provider (catalogRefs.ts), each
    // with the name the song gives it, from one lookup. Only the kinds the provider has (its
    // `albums` / `artists` capabilities); none for a song that is not online. May ask the provider.
    async getSongCatalogRefs(song: UnifiedSong): Promise<ProviderSongCatalogRefs> {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return { album: null, artists: [] };
        const provider = getOnlineMusicProvider(source.providerId);
        return resolveSongCatalogRefSet(song, {
            album: providerSupports(provider, 'albums'),
            artists: providerSupports(provider, 'artists'),
        });
    },

    getSongPageUrl(song: SongResult): string | null {
        return providerForSong(song).getSongPageUrl?.(song) ?? null;
    },
};
