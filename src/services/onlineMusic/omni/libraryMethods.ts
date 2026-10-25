import type { UnifiedSong } from '../../../types';
import type {
    MediaId,
    OmniCollection,
    OmniExploreItemsPage,
    OmniExplorePage,
    OmniHistoryEntry,
    OmniPage,
    OmniProviderId,
    OmniUser,
    OnlineMusicProvider,
    PersonalFmRequestOptions,
    ProviderLikedSongIds,
} from '../../../types/onlineMusic';
import { DEFAULT_PERSONAL_FM_CATALOG } from '../fmModes';
import { getOnlineMusicProvider, providerSupports, requireOnlineMusicProvider } from '../providerRegistry';
import { withActiveProvider } from './activeProvider';
import { emptyPage } from './providerCalls';
import type { PageInput } from './providerCalls';

// src/services/onlineMusic/omni/libraryMethods.ts
// The signed-in account's library and the recommendation pages: playlists, albums, the cloud
// entry, liked ids, the home feed, FM, history and explore.

/** 首页推荐的三块（私人 FM / 每日推荐 / 推荐歌单）。 */
type HomeFeedResult = {
    personalFm: UnifiedSong[];
    dailySongs: UnifiedSong[];
    recommendedCollections: OmniCollection[];
    /** 有一块失败、按空处理了：调用方可以照常显示，但下次应该再读一遍。 */
    partial?: true;
};

/**
 * 从一家平台读首页推荐。三块各自成败：一块失败（例如 QQ 日推被上游拒绝）只让那一块为空、
 * 结果标成 partial，不把 FM 与推荐歌单一起拖下去；三块都失败才算这次读取失败。
 * 作废（AbortError）不算某一块的失败，整次照常作废。
 */
const readHomeFeedFromProvider = async (provider: OnlineMusicProvider, limit: number): Promise<HomeFeedResult> => {
    const recommendations = provider.recommendations;
    const [personalFm, dailySongs, recommendedCollections] = await Promise.allSettled([
        recommendations?.getPersonalFm?.() ?? [],
        recommendations?.getDailySongs?.() ?? [],
        recommendations?.getRecommendedCollections?.(limit) ?? [],
    ]);
    const settled = [personalFm, dailySongs, recommendedCollections];
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    const aborted = failures.find(failure => (failure.reason as { name?: unknown } | null)?.name === 'AbortError');
    if (aborted) throw aborted.reason;
    if (failures.length === settled.length) throw failures[0].reason;
    failures.forEach(failure => console.warn('[Omni] Home feed section failed', {
        providerId: provider.id,
        name: failure.reason instanceof Error ? failure.reason.name : 'Error',
        message: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    }));
    const valueOf = <T>(result: PromiseSettledResult<T[]>): T[] => (result.status === 'fulfilled' ? result.value : []);
    return {
        personalFm: valueOf(personalFm),
        dailySongs: valueOf(dailySongs),
        recommendedCollections: valueOf(recommendedCollections),
        ...(failures.length > 0 ? { partial: true as const } : {}),
    };
};

export const libraryMethods = {
    async getUserPlaylists(userId: MediaId, page: PageInput): Promise<OmniPage<OmniCollection>> {
        return withActiveProvider(async provider => provider.library?.getUserPlaylists?.(userId, page.limit, page.offset) ?? emptyPage(page.offset));
    },

    async getUserAlbums(userId: MediaId, page: PageInput): Promise<OmniPage<OmniCollection>> {
        return withActiveProvider(async provider => provider.library?.getUserAlbums?.(userId, page.limit, page.offset) ?? emptyPage(page.offset));
    },

    /*
     * 按**指定**平台读收藏专辑。
     *
     * 上面的 getUserAlbums 只走当前平台，而首页「全部」那一屏要把各家登录着的平台的
     * 专辑合在一起看 —— 一家一家问过去，不能只问当前这一家（当前这家居然不支持时，
     * 合并视图就整个空着，明明别家有）。
     */
    async getProviderUserAlbums(providerId: OmniProviderId, userId: MediaId, page: PageInput): Promise<OmniPage<OmniCollection>> {
        const library = requireOnlineMusicProvider(providerId).library;
        if (!library?.getUserAlbums) return emptyPage(page.offset);
        return library.getUserAlbums(userId, page.limit, page.offset);
    },

    // A provider without this read answers with nothing read, and not whole: nothing held is taken away.
    async getLikedSongIds(userId: MediaId): Promise<ProviderLikedSongIds> {
        return withActiveProvider(async provider => provider.library?.getLikedSongIds?.(userId) ?? { ids: [], whole: false });
    },

    async getProviderLikedSongIds(providerId: OmniProviderId, userId: MediaId): Promise<ProviderLikedSongIds> {
        return requireOnlineMusicProvider(providerId).library?.getLikedSongIds?.(userId) ?? { ids: [], whole: false };
    },

    async getCloudCollection(user?: OmniUser): Promise<OmniCollection | null> {
        return withActiveProvider(async provider => provider.library?.getCloudCollection?.(user) ?? null);
    },

    async getProviderCloudCollection(providerId: OmniProviderId, user?: OmniUser): Promise<OmniCollection | null> {
        return requireOnlineMusicProvider(providerId).library?.getCloudCollection?.(user) ?? null;
    },

    normalizeCachedUser(providerId: OmniProviderId, raw: unknown): OmniUser | null {
        return requireOnlineMusicProvider(providerId).normalizeUser?.(raw) ?? null;
    },

    normalizeCachedCollection(providerId: OmniProviderId, raw: unknown, type?: string): OmniCollection | null {
        return requireOnlineMusicProvider(providerId).normalizeCollection?.(raw, type) ?? null;
    },

    async getHomeFeed(limit = 35): Promise<HomeFeedResult> {
        return withActiveProvider(provider => readHomeFeedFromProvider(provider, limit));
    },

    /*
     * 按**指定**平台读首页推荐。
     *
     * 理由同 getProviderUserAlbums：首页「全部」那一屏要把各家的电台合在一起看，
     * 只问当前这一家的话，别家登录着的推荐歌单就永远不出现。
     * 这里不挂「当前平台变了就作废」那道闸 —— 传进来的就是明确的一家，切平台不该
     * 把这次读取掐掉。
     */
    async getProviderHomeFeed(providerId: OmniProviderId, limit = 35): Promise<HomeFeedResult> {
        return readHomeFeedFromProvider(requireOnlineMusicProvider(providerId), limit);    },

    async getPersonalFmCatalog(providerId: OmniProviderId) {
        return requireOnlineMusicProvider(providerId).recommendations?.getPersonalFmCatalog?.() ?? DEFAULT_PERSONAL_FM_CATALOG;
    },

    async getPersonalFm(options?: PersonalFmRequestOptions): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getPersonalFm?.(options) ?? []);
    },

    async getDailySongs(refresh?: boolean): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getDailySongs?.(refresh) ?? []);
    },

    async getRecommendationHistory(): Promise<OmniHistoryEntry[]> {
        return withActiveProvider(async provider => provider.recommendations?.getHistoryEntries?.() ?? []);
    },

    async getRecommendationHistoryDates(): Promise<string[]> {
        return withActiveProvider(async provider => provider.recommendations?.getHistoryDates?.() ?? []);
    },

    async getRecommendationHistorySongs(entry: OmniHistoryEntry | string): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getHistorySongs?.(entry) ?? []);
    },

    supportsExplore(providerId: OmniProviderId): boolean {
        const provider = getOnlineMusicProvider(providerId);
        return providerSupports(provider, 'explore') && Boolean(provider?.explore);
    },

    // The active provider's own recommendation page; `cursor` asks for its further sections, and
    // `listened` (see `OnlineExploreProvider`) goes with a read from the start.
    async getExploreFeed(cursor?: string, listened?: UnifiedSong[]): Promise<OmniExplorePage> {
        return withActiveProvider(async provider => provider.explore?.getFeed(cursor, listened) ?? { sections: [] });
    },

    async getExploreSectionItems(cursor: string): Promise<OmniExploreItemsPage> {
        return withActiveProvider(async provider => provider.explore?.getSectionItems?.(cursor) ?? { items: [] });
    },
};
