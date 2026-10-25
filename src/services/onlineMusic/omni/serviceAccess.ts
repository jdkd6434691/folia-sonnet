import type { MediaId, OmniCollection, OmniProviderId, ProviderLikedSongIds } from '../../../types/onlineMusic';

// src/services/onlineMusic/omni/serviceAccess.ts
// The assembled facade, for the two calls one capability group makes through another
// (addSongToPlaylist -> refreshProviderPlaylists, the liked-list read -> getProviderLikedSongIds): the
// lookup stays on the exported object, so a caller or a test that replaces one method is heard.

type BoundOmniService = {
    refreshProviderPlaylists(providerId: OmniProviderId): Promise<OmniCollection[]>;
    getProviderLikedSongIds(providerId: OmniProviderId, userId: MediaId): Promise<ProviderLikedSongIds>;
};

let bound: BoundOmniService | undefined;

export const bindOmniService = (service: BoundOmniService): void => {
    bound = service;
};

export const omniService = (): BoundOmniService => {
    if (!bound) throw new Error('omni was called before it was assembled');
    return bound;
};
