import type { SongResult, UnifiedSong } from '../../../types';
import type { MediaId, OmniCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import type { LikePress } from '../../../utils/likePresses';
import { getOnlineMusicProvider, providerSupports } from '../providerRegistry';
import { likePressesOf, persistProviderLikedSongIds, readLikedSongIds, sendSongLike } from './accountLikes';
import { providerForCollection, providerForSong, unsupported } from './providerCalls';
import { omniService } from './serviceAccess';

// src/services/onlineMusic/omni/mutationMethods.ts
// Likes, playlists and subscriptions made at the provider that owns the song or the collection.

export const mutationMethods = {
    // Reads cached like state through Omni. A heart pressed and not yet settled answers with what
    // was asked for (`pressSongLike`).
    isSongLiked(song: SongResult, fallbackLikedSongIds?: Iterable<MediaId>): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;

        const account = useOnlineProviderAccountStore.getState().accounts[source.providerId];
        const songKey = String(source.mediaId);
        const wanted = account?.wantedLikes?.[songKey];
        if (wanted !== undefined) return wanted;

        // 网易刷新账户的那几秒里 account.likedSongIds 会被清空，心形跟着熄灭。调用方手上有刷新前
        // 那份列表时先按它答（见 useNeteaseLibrary 的 updateProviderAccount）。
        const likedSongIds = source.providerId === 'netease' && fallbackLikedSongIds
            ? fallbackLikedSongIds
            : account?.likedSongIds || [];
        for (const id of likedSongIds) {
            if (String(id) === songKey) return true;
        }
        return false;
    },

    // Toggles a song through its source provider. `likeSong` is what keeps the account cache in
    // sync, so every entry point - this one, the liked grid, a command - lands in the same state.
    async toggleSongLike(song: SongResult): Promise<boolean> {
        const nextLiked = !this.isSongLiked(song);
        await this.likeSong(song, nextLiked);
        return nextLiked;
    },

    // Returns the cached playlists owned by the provider that owns the current song.
    getPlaylistsForSong(song: SongResult): OmniCollection[] {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return [];
        const provider = getOnlineMusicProvider(source.providerId);
        if (
            !providerSupports(provider, 'mutations')
            || !providerSupports(provider, 'playlistTrackMutations')
            || !provider?.mutations?.updatePlaylistTracks
        ) {
            return [];
        }
        const collections = useOnlineProviderAccountStore.getState().accounts[source.providerId]?.collections || [];
        return collections.filter(collection => (
            collection.type === 'playlist'
            && (provider.mutations?.canAddToPlaylist?.(collection) ?? true)
        ));
    },

    canAddSongToPlaylist(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'mutations')
            && providerSupports(provider, 'playlistTrackMutations')
            && Boolean(provider?.mutations?.updatePlaylistTracks);
    },

    // Whether a playlist can be made on the song's provider to put the song in.
    canCreatePlaylistForSong(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        return source.kind === 'online'
            && this.canAddSongToPlaylist(song)
            && Boolean(getOnlineMusicProvider(source.providerId)?.mutations?.createPlaylist);
    },

    canLikeSong(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'mutations')
            && providerSupports(provider, 'likes')
            && Boolean(provider?.mutations?.likeSong);
    },

    canEditCollectionTracks(collection: OmniCollection): boolean {
        const provider = getOnlineMusicProvider(collection.providerId);
        if (!providerSupports(provider, 'mutations')) return false;
        if (collection.isLiked === true) {
            return providerSupports(provider, 'likes') && Boolean(provider?.mutations?.likeSong);
        }
        return providerSupports(provider, 'playlistTrackMutations')
            && Boolean(provider?.mutations?.updatePlaylistTracks)
            && (provider?.mutations?.canEditPlaylistTracks?.(collection) ?? true);
    },

    canDislikeSong(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'recommendations')
            && Boolean(provider?.recommendations?.dislikeSong);
    },

    /** 每日推荐里「不喜欢并换一首」：集合所属 provider 有 dislikeSong 才能管理推荐（有日推不等于能不喜欢）。 */
    canDislikeCollectionSongs(collection: OmniCollection): boolean {
        const provider = getOnlineMusicProvider(collection.providerId);
        return providerSupports(provider, 'recommendations')
            && Boolean(provider?.recommendations?.dislikeSong);
    },

    canSubscribeCollection(collection: OmniCollection): boolean {
        const provider = getOnlineMusicProvider(collection.providerId);
        if (
            !providerSupports(provider, 'mutations')
            || !providerSupports(provider, 'playlistSubscription')
            || provider?.mutations?.canSubscribe?.(collection) === false
        ) {
            return false;
        }
        if (collection.type === 'album') return Boolean(provider?.mutations?.subscribeAlbum);
        // 自己的歌单（含「我喜欢」）谈不上收藏。以前靠「能编辑就不显示收藏」挡住，但有的平台能收藏歌单却不能红心，
        // 「我喜欢」编辑不了，会落到收藏分支，一点就是去收藏自己的 201 目录。
        if (collection.isOwned === true || collection.isLiked === true) return false;
        return Boolean(provider?.mutations?.subscribePlaylist);
    },

    async subscribe(collection: OmniCollection, subscribed: boolean): Promise<void> {
        const mutations = providerForCollection(collection).mutations;
        if (!this.canSubscribeCollection(collection)) {
            return unsupported(collection.providerId, 'collection-subscription');
        }
        if (collection.type === 'album') {
            if (!mutations?.subscribeAlbum) return unsupported(collection.providerId, 'album-subscription');
            return mutations.subscribeAlbum(collection.id, subscribed);
        }
        if (!mutations?.subscribePlaylist) return unsupported(collection.providerId, 'playlist-subscription');
        return mutations.subscribePlaylist(collection, subscribed);
    },

    async updateCollectionTracks(collection: OmniCollection, operation: 'add' | 'del', tracks: SongResult[]): Promise<void> {
        const provider = providerForCollection(collection);
        const mutations = provider.mutations;
        if (
            !providerSupports(provider, 'mutations')
            || !providerSupports(provider, 'playlistTrackMutations')
            || !mutations?.updatePlaylistTracks
        ) {
            return unsupported(collection.providerId, 'playlist-track-mutations');
        }
        return mutations.updatePlaylistTracks(operation, collection, tracks);
    },

    // Makes a playlist on the song's provider and puts the song in it.
    async createPlaylistWithSong(song: SongResult, name: string): Promise<void> {
        const source = getPlaybackSourceRef(song);
        const mutations = source.kind === 'online' ? getOnlineMusicProvider(source.providerId)?.mutations : undefined;
        if (source.kind !== 'online' || !this.canCreatePlaylistForSong(song) || !mutations?.createPlaylist) {
            throw new OnlineProviderError('unsupported', 'Song provider does not make playlists', source.kind === 'online' ? source.providerId : undefined);
        }
        const playlist = await mutations.createPlaylist(name);
        try {
            await this.addSongToPlaylist(song, playlist);
        } catch (error) {
            // The playlist exists: it must show in the picker, or a second try makes a second one.
            void omniService().refreshProviderPlaylists(playlist.providerId).catch(() => undefined);
            throw error;
        }
    },

    async addSongToPlaylist(song: SongResult, playlist: OmniCollection): Promise<void> {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') {
            throw new OnlineProviderError('unsupported', 'Only online songs can be added to online playlists');
        }
        if (playlist.providerId !== source.providerId || playlist.type !== 'playlist') {
            throw new OnlineProviderError('unsupported', 'Playlist does not belong to the song provider', source.providerId);
        }
        if (!this.canAddSongToPlaylist(song)) {
            throw new OnlineProviderError('unsupported', 'Song provider does not support playlist track mutations', source.providerId);
        }
        const provider = providerForCollection(playlist);
        if (provider.mutations?.canAddToPlaylist && !provider.mutations.canAddToPlaylist(playlist)) {
            throw new OnlineProviderError('unsupported', 'Playlist does not accept track mutations', source.providerId);
        }
        await this.updateCollectionTracks(playlist, 'add', [song]);
        try {
            await omniService().refreshProviderPlaylists(playlist.providerId);
            if (playlist.isLiked === true && providerSupports(provider, 'likes')) {
                const userId = useOnlineProviderAccountStore.getState().accounts[playlist.providerId]?.user?.id;
                if (userId !== undefined && userId !== null) {
                    // A full liked list may be large: success does not wait for it.
                    void readLikedSongIds(playlist.providerId, userId).catch(error => {
                        console.warn('[Omni] Failed to refresh liked songs after playlist mutation', { providerId: playlist.providerId }, error);
                    });
                }
            }
        } catch (error) {
            console.warn('[Omni] Failed to refresh provider playlists after mutation', { providerId: playlist.providerId }, error);
        }
    },

    // A press on a song's heart: the other state than the one shown, or `liked` where it is given.
    // The heart answers at once - until the request is settled, `isSongLiked` says what was asked
    // for - and the request goes out after, one at a time for a song (likePresses.ts). `settled`
    // tells how it ended and never rejects; after a failed request the heart shows what the
    // account holds again. Throws at once where the song's provider takes no likes.
    pressSongLike(song: SongResult, liked?: boolean): LikePress {
        const provider = providerForSong(song);
        if (!this.canLikeSong(song) || !provider.mutations?.likeSong) return unsupported(provider.id, 'likes');

        // canLikeSong 已经保证了这一点，这里只是把类型收窄；真走到就说明上面的判断被绕过了。
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return unsupported(provider.id, 'likes');

        const press = likePressesOf(source.providerId).press(
            String(source.mediaId),
            liked ?? !this.isSongLiked(song),
            (sent, signal) => sendSongLike(provider, song, source, sent, signal),
        );
        if (!press.joined) {
            void press.settled.then(outcome => {
                if (outcome.ok) return;
                console.warn(`[Like] ${source.providerId}:${String(source.mediaId)} put back: it shows ${this.isSongLiked(song) ? 'liked' : 'not liked'} again, which is what the account holds`);
            });
        }
        return press;
    },

    // The same press, waited for: resolves once the provider holds `liked`. Rejects when a
    // request failed, and when a heart pressed again meanwhile left the provider with the other
    // state: the caller did not get what it asked for (the liked list's grid keeps the row then).
    async likeSong(song: SongResult, liked: boolean): Promise<void> {
        const outcome = await this.pressSongLike(song, liked).settled;
        if (!outcome.ok) throw outcome.error;
        if (outcome.liked !== liked) {
            throw new Error(`The song ended ${outcome.liked ? 'liked' : 'not liked'}: its heart was pressed again meanwhile`);
        }
    },

    async dislikeSong(song: SongResult): Promise<{ replacement?: UnifiedSong; limitReached?: boolean }> {
        const provider = providerForSong(song);
        if (!this.canDislikeSong(song) || !provider.recommendations?.dislikeSong) {
            return unsupported(provider.id, 'recommendation-dislike');
        }
        return provider.recommendations.dislikeSong(song.id);
    },
};
