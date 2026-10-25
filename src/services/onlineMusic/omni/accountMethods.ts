import type { SongResult } from '../../../types';
import type { MediaId, OmniCollection, OmniProviderId } from '../../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import type { AccountReadOutcome, AccountReadReason } from '../account/accountRead';
import type { SongInPlay } from '../account/likedChecks';
import type { AccountMoment } from '../account/readMoments';
import { getOnlineMusicProvider, providerSupports } from '../providerRegistry';
import { activeProviderId } from './activeProvider';
import {
    accountMoments,
    accountReads,
    applyLikedIdsRead,
    beginLikedRead,
    likedChecks,
    persistProviderLikedSongIds,
} from './accountLikes';
import type { LikedListRead } from './accountLikes';

// src/services/onlineMusic/omni/accountMethods.ts
// Reading an account from its platform and the moments at which its liked songs may have changed
// elsewhere.

export const accountMethods = {
    // Reads who is signed in to a provider, their playlists and their liked songs from the
    // platform, and settles them in the account store (account/accountRead.ts): at app start,
    // after a sign-in, at a platform switch and for the sync button. A read asked for while one
    // of the provider is under way joins it. Never rejects.
    readAccount(providerId: OmniProviderId, reason: AccountReadReason): Promise<AccountReadOutcome> {
        return accountReads.read(providerId, reason);
    },

    // The listener signs out of a provider: the account leaves the screen at once, the platform
    // is told, and what was kept of the account on disk goes. Never rejects.
    signOutAccount(providerId: OmniProviderId): Promise<void> {
        return accountReads.signOut(providerId);
    },

    // Reads the playlists of the account shown again, after a change made to one in Folia and
    // when the home screen is entered, and keeps them with the account. Rejects where they could
    // not be read.
    refreshProviderPlaylists(providerId: OmniProviderId): Promise<OmniCollection[]> {
        return accountReads.readPlaylists(providerId);
    },

    // The start of a read of a collection's songs from its first page. For the signed-in account's
    // liked list it answers with a note of the moment, to be handed back with the songs when the
    // read is over (`endLikedListRead`); for any other collection, with null.
    beginLikedListRead(collection: OmniCollection): LikedListRead | null {
        if (collection.isLiked !== true) return null;
        const account = useOnlineProviderAccountStore.getState().accounts[collection.providerId];
        const userId = account?.user?.id;
        if (userId === undefined || userId === null || !providerSupports(getOnlineMusicProvider(collection.providerId), 'likes')) return null;
        // The account's own liked list stands in its library with the mark. A list that only
        // carries the mark (someone else's, say) is not taken for it.
        const isOwn = (account?.collections || []).some(own => (
            own.isLiked === true && own.type === collection.type && String(own.id) === String(collection.id)
        ));
        return isOwn ? beginLikedRead(collection.providerId, userId) : null;
    },

    // The end of a read of the liked list. `whole`: every page was read in one go, none failed,
    // and the provider said the list ends there. The songs read meet what the account holds by the
    // one rule (account/keptAfterRead.ts): read whole, a song that left the list elsewhere loses
    // its heart here; not read whole, the list only adds hearts, and the songs in play are checked
    // (account/likedChecks.ts). While a pressed song's request is unsettled, what was asked for is
    // shown anyway.
    endLikedListRead(read: LikedListRead, songs: SongResult[], whole: boolean): void {
        const ids: MediaId[] = [];
        for (const song of songs) {
            const source = getPlaybackSourceRef(song);
            if (source.kind === 'online' && source.providerId === read.providerId) ids.push(source.mediaId);
        }
        if (applyLikedIdsRead(read, { ids, whole }).changed) void persistProviderLikedSongIds(read.providerId);
    },

    // A moment at which the account shown may have been changed in the platform's own app
    // (src/hooks/useAccountReads.ts tells of them). At the home screen its playlists are read
    // again (accountRead.ts guards how often); whether the platform is asked for its liked songs
    // is decided in account/readMoments.ts. Answers how the read of the playlists ended, 'not
    // asked' where none was made. Never throws or rejects.
    accountMoment(moment: AccountMoment): Promise<AccountReadOutcome> {
        const providerId = activeProviderId();
        const playlists = moment === 'home-entered' ? accountReads.readAtHome(providerId) : Promise.resolve<AccountReadOutcome>('not asked');
        void accountMoments(moment, providerId);
        return playlists;
    },

    // The songs being played and queued, the one playing first (src/hooks/useAccountReads.ts
    // tells of them). Where a platform's liked list was not read to the end, their hearts are
    // asked of the platform (account/likedChecks.ts). Never throws or rejects.
    songsInPlay(songs: SongResult[]): void {
        const inPlay: SongInPlay[] = [];
        for (const song of songs) {
            const source = getPlaybackSourceRef(song);
            if (source.kind === 'online') inPlay.push({ providerId: source.providerId, mediaId: source.mediaId });
        }
        likedChecks.songsInPlay(inPlay);
    },
};
