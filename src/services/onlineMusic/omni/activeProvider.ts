import type { OnlineMusicProvider, OmniProviderId } from '../../../types/onlineMusic';
import { DEFAULT_ONLINE_PROVIDER_ID } from '../../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getOnlineMusicProvider, requireOnlineMusicProvider } from '../providerRegistry';

// src/services/onlineMusic/omni/activeProvider.ts
// The provider the calls without one go to, and the generation that makes a late answer from a
// provider the person has left arrive as AbortError.

export const activeProviderId = (): OmniProviderId => {
    const storedProviderId = useOnlineProviderAccountStore.getState().activeProviderId;
    // A persisted selection can outlive its provider when switching builds or branches.
    return getOnlineMusicProvider(storedProviderId) ? storedProviderId : DEFAULT_ONLINE_PROVIDER_ID;
};

export const activeProvider = () => requireOnlineMusicProvider(activeProviderId());

let activeRequestGeneration = 0;

// Rejects late active-provider responses after an account switch transaction begins.
export const withActiveProvider = async <T>(run: (provider: OnlineMusicProvider) => Promise<T>): Promise<T> => {
    const providerId = activeProviderId();
    const generation = activeRequestGeneration;
    const result = await run(requireOnlineMusicProvider(providerId));
    if (generation !== activeRequestGeneration || providerId !== activeProviderId()) {
        throw new DOMException('Active online provider changed', 'AbortError');
    }
    return result;
};

export const invalidateActiveRequests = (): void => {
    activeRequestGeneration += 1;
};

export const getActiveRequestGeneration = (): number => activeRequestGeneration;
