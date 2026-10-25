import type { SongResult, UnifiedSong } from '../../../types';
import type {
    LoginStep,
    OmniCollection,
    OmniPage,
    OmniRequestRunner,
    OmniProviderId,
    OmniSongDetail,
    OnlineAuthProvider,
    OnlineFailureOperation,
    OnlineMusicProvider,
    OnlineSearchProvider,
    ProviderSearchContext,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { getOnlineMusicProviderForSong, requireOnlineMusicProvider } from '../providerRegistry';
import { noteLoginFailure } from '../login/loginFailureCase';
import { noteOnlineFailure } from '../failure/onlineFailureCase';

// src/services/onlineMusic/omni/providerCalls.ts
// The provider lookups and request wrappers every capability group calls: which provider owns a
// song or a collection, what a failure is noted as, and the paging shapes.

export type PageInput = { limit: number; offset: number };

export const providerForSong = (song: SongResult) => {
    const provider = getOnlineMusicProviderForSong(song);
    if (!provider) throw new OnlineProviderError('unsupported', 'Song is not owned by an online provider');
    return provider;
};

export const providerForCollection = (collection: OmniCollection) => requireOnlineMusicProvider(collection.providerId);

export const unsupported = (providerId: OmniProviderId, capability: string): never => {
    throw new OnlineProviderError('unsupported', `${capability} is not supported by ${providerId}`, providerId);
};

// Runs one step of a sign-in. Where the step throws, what the provider knows of the failure
// (`describeLoginFailure`) is left on the error for the sign-in dialog (login/loginFailureCase.ts);
// the error itself goes on as it is, also when the provider's function throws.
export const runLoginStep = async <T>(auth: OnlineAuthProvider, step: LoginStep, run: () => Promise<T>): Promise<T> => {
    try {
        return await run();
    } catch (error) {
        try {
            noteLoginFailure(error, auth.describeLoginFailure?.(step, error));
        } catch (describeError) {
            console.warn('[Omni] describeLoginFailure threw; the sign-in error goes on without a note', { step }, describeError);
        }
        throw error;
    }
};

// Runs a request for a song's audio or a collection's tracks. Where it throws, what the provider
// knows of the failure (`describeFailure`) is left on the error for the message that tells of it
// (failure/onlineFailureCase.ts); the error itself goes on as it is, also when the provider's function throws.
export const runRequest = async <T>(provider: OnlineMusicProvider, operation: OnlineFailureOperation, run: () => Promise<T>): Promise<T> => {
    try {
        return await run();
    } catch (error) {
        try {
            noteOnlineFailure(error, provider.describeFailure?.(operation, error));
        } catch (describeError) {
            console.warn('[Omni] describeFailure threw; the error goes on without a note', { operation }, describeError);
        }
        throw error;
    }
};

export const emptyPage = <T>(offset: number): OmniPage<T> => ({ items: [], hasMore: false, nextOffset: offset });

// A search with the caller's context (`ProviderSearchContext`) where it gave one, handed on as it
// is; a search without one reaches the provider as the host's own searches always have.
export const searchWith = (
    search: OnlineSearchProvider,
    query: string,
    page: PageInput,
    context?: ProviderSearchContext,
): Promise<OmniPage<UnifiedSong>> => (
    context
        ? search.searchSongs(query, page.limit, page.offset, context)
        : search.searchSongs(query, page.limit, page.offset)
);

// A request that goes straight to the provider, for a caller that hands in no runner.
export const runDirectly: OmniRequestRunner = work => work();

// One request through a caller's runner (`OmniRequestRunner`), telling a failure of the request
// itself (`failed`, with the provider's own error) apart from the runner refusing it or giving up
// waiting for it (`refused`, with what the runner rejected with).
export type RunOutcome<T> =
    | { kind: 'answered'; value: T }
    | { kind: 'failed'; error: unknown }
    | { kind: 'refused'; error: unknown };

export const runThrough = async <T>(run: OmniRequestRunner, work: () => Promise<T>): Promise<RunOutcome<T>> => {
    const own: { failed: boolean; error: unknown } = { failed: false, error: undefined };
    try {
        const value = await run(async () => {
            try {
                return await work();
            } catch (error) {
                own.failed = true;
                own.error = error;
                throw error;
            }
        });
        return { kind: 'answered', value };
    } catch (error) {
        return own.failed ? { kind: 'failed', error: own.error } : { kind: 'refused', error };
    }
};

export const songDetailOf = (song: UnifiedSong | null | undefined): OmniSongDetail => (
    song ? { status: 'found', song } : { status: 'missing' }
);
