import type { UnifiedSong } from '../../../types';
import type {
    LoginDiagnosticLine,
    LoginLocalService,
    LoginMethod,
    LoginSelfCheckResult,
    LoginState,
    LoginTexts,
    OmniPage,
    OmniProviderCapabilities,
    OmniProviderId,
    OmniProviderSummary,
    OmniUser,
    PasswordLoginCredentials,
    ProviderMark,
    ProviderNotice,
    ProviderSearchContext,
} from '../../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { errorMessage } from '../../../utils/errorText';
import { diagnosticLine } from '../login/loginDiagnosticReport';
import {
    getOnlineMusicProvider,
    getOnlineMusicProviderRegistryVersion,
    listOnlineMusicProviders,
    providerSupports,
    requireOnlineMusicProvider,
    subscribeOnlineMusicProviderRegistry,
} from '../providerRegistry';
import {
    activeProvider,
    activeProviderId,
    getActiveRequestGeneration as getActiveProviderRequestGeneration,
    invalidateActiveRequests as invalidateActiveProviderRequests,
    withActiveProvider,
} from './activeProvider';
import { emptyPage, runLoginStep, searchWith, unsupported } from './providerCalls';
import type { PageInput } from './providerCalls';

// src/services/onlineMusic/omni/providerMethods.ts
// The provider list, what each one can do, its sign-in steps and the searches: what the account
// screen and the sign-in dialog ask a provider itself, rather than one of its songs.

export const providerMethods = {
    invalidateActiveRequests(): void {
        invalidateActiveProviderRequests();
    },

    getActiveRequestGeneration(): number {
        return getActiveProviderRequestGeneration();
    },

    // The provider list changes at runtime (Folium mods). A useSyncExternalStore pair for the UI.
    subscribeProviders(listener: () => void): () => void {
        return subscribeOnlineMusicProviderRegistry(listener);
    },

    getProviderRegistryVersion(): number {
        return getOnlineMusicProviderRegistryVersion();
    },

    getProviderSummaries(): OmniProviderSummary[] {
        const accounts = useOnlineProviderAccountStore.getState().accounts;
        return listOnlineMusicProviders().map(provider => {
            const account = accounts[provider.id];
            return {
                providerId: provider.id,
                displayName: provider.displayName,
                shortName: provider.shortName || provider.displayName,
                availability: provider.getAvailability?.() ?? { configured: true },
                requiresAccount: provider.capabilities.auth,
                status: account?.status || 'unknown',
                user: account?.user || null,
                collections: account?.collections || [],
                error: account?.error,
                hydration: account?.hydration || 'loading',
                freshness: account?.freshness || 'stale',
                lastUpdatedAt: account?.lastUpdatedAt,
            };
        });
    },

    getActiveProviderSummary(): OmniProviderSummary | undefined {
        const providerId = activeProviderId();
        return this.getProviderSummaries().find(provider => provider.providerId === providerId);
    },

    getActiveCapabilities(): OmniProviderCapabilities {
        return activeProvider().capabilities;
    },

    getProviderCapabilities(providerId: OmniProviderId): OmniProviderCapabilities {
        return requireOnlineMusicProvider(providerId).capabilities;
    },

    supportsDailySongs(providerId: OmniProviderId): boolean {
        return typeof requireOnlineMusicProvider(providerId).recommendations?.getDailySongs === 'function';
    },

    getProviderLabel(providerId: OmniProviderId): string {
        const provider = getOnlineMusicProvider(providerId);
        return provider?.shortName || provider?.displayName || providerId;
    },

    // `context.session` keeps a caller's paging apart from the host's own (`ProviderSearchContext`);
    // without it the search is the host UI's.
    async searchSongs(query: string, page: PageInput, context?: ProviderSearchContext): Promise<OmniPage<UnifiedSong>> {
        return withActiveProvider(async provider => {
            if (!providerSupports(provider, 'search') || !provider.search) return emptyPage(page.offset);
            return searchWith(provider.search, query, page, context);
        });
    },

    async searchProviderSongs(
        providerId: OmniProviderId,
        query: string,
        page: PageInput,
        context?: ProviderSearchContext,
    ): Promise<OmniPage<UnifiedSong>> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!providerSupports(provider, 'search') || !provider.search) return emptyPage(page.offset);
        return searchWith(provider.search, query, page, context);
    },

    // 平台的记号（一个字和一种颜色）。平台没有声明就回 null，界面自己从它的短名取。
    getProviderMark(providerId: OmniProviderId): ProviderMark | null {
        return getOnlineMusicProvider(providerId)?.mark ?? null;
    },

    // 登录窗口里这个平台自己的标题和说明（i18n key）；没有声明就回 null。
    getLoginTexts(providerId: OmniProviderId): LoginTexts | null {
        return getOnlineMusicProvider(providerId)?.auth?.getLoginTexts?.() ?? null;
    },

    // Starts what each provider watches while the app is open (`watch`): the registered ones,
    // once. Answers with the way to stop them all.
    watchProviders(tell: (notice: ProviderNotice) => void): () => void {
        const stops = listOnlineMusicProviders().flatMap(provider => (provider.watch ? [provider.watch(tell)] : []));
        return () => stops.forEach(stop => stop());
    },

    // 登录要靠的、可以在登录窗口里重启的本地服务；这个平台没有就回 null。
    getLoginLocalService(providerId: OmniProviderId): LoginLocalService | null {
        return getOnlineMusicProvider(providerId)?.auth?.localService ?? null;
    },

    /** 用户名密码登录（飞牛这类自建服务）。没有这个能力就抛 unsupported，界面不会走到这里。 */
    async loginWithPassword(providerId: OmniProviderId, credentials: PasswordLoginCredentials): Promise<OmniUser | null> {
        const auth = requireOnlineMusicProvider(providerId).auth;
        if (!auth?.loginWithPassword) return unsupported(providerId, 'password-login');
        return auth.loginWithPassword(credentials);
    },

    /** 密码登录表单的预填值（上次填过的服务器地址）；按选中的登录方式给，provider 不提供就是空对象。 */
    getPasswordLoginDefaults(providerId: OmniProviderId, methodId?: string | null): { serverUrl?: string } {
        return requireOnlineMusicProvider(providerId).auth?.getPasswordLoginDefaults?.(methodId ?? null) ?? {};
    },

    // 没有这个能力就回空数组，UI 据此走单步流程；netease / kugou 完全不受影响。
    getLoginMethods(providerId: OmniProviderId): LoginMethod[] {
        return requireOnlineMusicProvider(providerId).auth?.getLoginMethods?.() ?? [];
    },

    async resolveLoginMethods(providerId: OmniProviderId): Promise<LoginMethod[]> {
        const auth = requireOnlineMusicProvider(providerId).auth;
        if (!auth) return [];
        return auth.resolveLoginMethods?.() ?? auth.getLoginMethods?.() ?? [];
    },

    // 扫码的 provider 回二维码图片；在浏览器里确认的登录没有图片，回空串。
    async startLogin(providerId: OmniProviderId, methodId?: string): Promise<{ key: string; imageUrl: string }> {
        const provider = requireOnlineMusicProvider(providerId);
        const auth = provider.auth;
        if (!auth?.startLogin || (!auth.createQr && !auth.openLoginPage)) return unsupported(providerId, 'qr-login');
        return runLoginStep(auth, 'start', async () => {
            const key = await auth.startLogin!(methodId);
            return { key, imageUrl: auth.createQr ? await auth.createQr(key) : '' };
        });
    },

    // 在浏览器里确认的登录：没有二维码，UI 留一个打开浏览器的按钮。
    confirmsLoginInBrowser(providerId: OmniProviderId): boolean {
        const auth = requireOnlineMusicProvider(providerId).auth;
        return Boolean(auth?.openLoginPage && !auth.createQr);
    },

    // 这一次登录的页面由 provider 自己打开、不能再打开一次（`opensLoginPageItself`）。
    opensLoginPageItself(providerId: OmniProviderId, key: string): boolean {
        return requireOnlineMusicProvider(providerId).auth?.opensLoginPageItself?.(key) === true;
    },

    async openLoginPage(providerId: OmniProviderId, key: string): Promise<void> {
        const auth = requireOnlineMusicProvider(providerId).auth;
        if (!auth?.openLoginPage) return unsupported(providerId, 'qr-login-page');
        await runLoginStep(auth, 'open', () => auth.openLoginPage!(key));
    },

    async checkLogin(providerId: OmniProviderId, key: string): Promise<LoginState> {
        const auth = requireOnlineMusicProvider(providerId).auth;
        if (!auth?.checkLogin) return unsupported(providerId, 'qr-login');
        return runLoginStep(auth, 'check', () => auth.checkLogin!(key));
    },

    // 没有这个能力就静默 no-op：netease / kugou 的扫码流程完全不受影响。
    async cancelLogin(providerId: OmniProviderId, key: string): Promise<void> {
        await requireOnlineMusicProvider(providerId).auth?.cancelLogin?.(key);
    },

    // 诊断是失败之后的补救手段，自己不能再失败：provider 没实现就回空，抛错就把错误写进报告。
    async getLoginDiagnostics(providerId: OmniProviderId): Promise<LoginDiagnosticLine[]> {
        try {
            return await requireOnlineMusicProvider(providerId).auth?.getLoginDiagnostics?.() ?? [];
        } catch (error) {
            return [diagnosticLine`provider diagnostics unavailable: ${errorMessage(error)}`];
        }
    },

    // 登录失败后的主动自检：没有这个能力的 provider（mod 源也是）回 false / null。
    // 自检本身出错时照常抛出，由登录记进时间线与报告。
    canRunLoginSelfCheck(providerId: OmniProviderId): boolean {
        return Boolean(requireOnlineMusicProvider(providerId).auth?.canRunLoginSelfCheck?.());
    },

    async runLoginSelfCheck(providerId: OmniProviderId): Promise<LoginSelfCheckResult | null> {
        return await requireOnlineMusicProvider(providerId).auth?.runLoginSelfCheck?.() ?? null;
    },

    // 只有明确声明了这一次登录有效期的 provider 才由前端计时；其余照旧只认后端报出的过期状态。
    getLoginTtlMs(providerId: OmniProviderId): number | null {
        const ttlMs = requireOnlineMusicProvider(providerId).auth?.getLoginTtlMs?.();
        return typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : null;
    },
};
