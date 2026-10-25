import { ChevronLeft, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import GridPanelToggleIndicator from '../shared/GridPanelToggleIndicator';
import { Button } from '../../../../components/ui';

// src/library/suites/grid/collection/GridViewChrome.tsx
// GridView 顶上那一层：返回、后台补页 / 重试、AI 主题的换一批与中间那颗标题（原 GridView.tsx 的 JSX 原样搬出）。

type GridViewChromeProps = {
    onDone: () => void;
    isDaylight: boolean;
    /** 后台补页 / 重试那颗胶囊：显示条件、禁用条件与文案都按原来的分支。 */
    showBackgroundSync: boolean;
    backgroundLoading: boolean;
    backgroundLoadError: boolean;
    backgroundSyncLabel: string;
    backgroundFailureSaid: { title: string; note?: string; quote?: { text: string; code?: string } } | null;
    onResumeBackgroundSync: () => void;
    isCloudThemeCollection: boolean;
    canReloadThisCollection: boolean;
    loading: boolean;
    onReloadCollection: () => void;
    /** 中间的标题：有切入面板时可点开合。 */
    hasCutInPanel: boolean;
    isCutInPanelOpen: boolean;
    onToggleCutInPanel: () => void;
    heading: string;
    subtitle?: string;
    description?: string;
};

export const GridViewChrome = ({
    onDone,
    isDaylight,
    showBackgroundSync,
    backgroundLoading,
    backgroundLoadError,
    backgroundSyncLabel,
    backgroundFailureSaid,
    onResumeBackgroundSync,
    isCloudThemeCollection,
    canReloadThisCollection,
    loading,
    onReloadCollection,
    hasCutInPanel,
    isCutInPanelOpen,
    onToggleCutInPanel,
    heading,
    subtitle,
    description,
}: GridViewChromeProps) => {
    const { t } = useTranslation();

    return (
        <>
            {/* Back Button */}
            <Button
                // 返回按钮表示看完了（onDone）：宿主清掉浏览会话、让每套 suite 忘掉布局记录（网格的 sessionStorage
                // 记录经 entry 的 layout.forget），再返回。Escape 与浏览器后退保留（onBack）。P4.5 起不在这里清。
                onClick={onDone}
                tip={t('ui.back')}
                /* 安全区：`absolute top-5` —— CSS 用 margin-top 往下让（见 androidPhoneFit.css ⑥）。 */
                data-folia-safe-top="shift"
                className="absolute left-6 top-5 w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95 z-[70]"
                style={{
                    backgroundColor: isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                <ChevronLeft size={20} />
            </Button>
        
            {showBackgroundSync && (
                <Button
                    onClick={onResumeBackgroundSync}
                    disabled={!backgroundLoadError}
                    /* 安全区：右上角那颗同步 / 重试 —— 与返回按钮同一档 `absolute top-5`。 */
                    data-folia-safe-top="shift"
                    className="absolute right-6 top-5 z-[70] flex items-center gap-2 rounded-full px-3 py-2 text-xs tabular-nums backdrop-blur-md disabled:cursor-default"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg-color) 65%, transparent)' }}
                    title={backgroundFailureSaid
                        ? t('playlist.syncFailedHint', {
                            error: backgroundFailureSaid.quote
                                ? `${backgroundFailureSaid.title}: ${[backgroundFailureSaid.quote.text, backgroundFailureSaid.quote.code].filter(Boolean).join(' ')}`
                                : backgroundFailureSaid.title,
                        })
                        : backgroundSyncLabel}
                >
                    <RefreshCw size={14} className={backgroundLoading ? 'animate-spin' : ''} />
                    {backgroundSyncLabel}
                    {backgroundLoadError && <span className="font-semibold">{t('ui.retry')}</span>}
                </Button>
            )}
        
            {/* 「AI 主题」的换一批。
                占的是右上同一个位置（后台补页那颗 generic 胶囊对这一屏让开了），两者不并存。
                重拉会清空列表并从云端随机一处重新开始，所以它是刷新也是换一批。 */}
            {isCloudThemeCollection && canReloadThisCollection && (
                <Button
                    onClick={onReloadCollection}
                    disabled={loading}
                    /* 安全区：与返回按钮同一档 `absolute top-5`。 */
                    data-folia-safe-top="shift"
                    className="absolute right-6 top-5 z-[70] flex items-center gap-2 rounded-full px-3 py-2 text-xs tabular-nums backdrop-blur-md disabled:opacity-50"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg-color) 65%, transparent)' }}
                    title={t('playlist.reloadCloudTheme')}
                    aria-label={t('playlist.reloadCloudTheme')}
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    {loading ? t('playlist.loading') : t('playlist.reloadCloudTheme')}
                </Button>
            )}
        
            {/* Center Clickable Area */}
            <div
                onClick={() => {
                    if (!hasCutInPanel) return;
                    onToggleCutInPanel();
                }}
                /* 安全区：居中标题。垂直方向是 `absolute top-5`（不是居中），所以 margin-top
                   就是整份位移 —— 与艺术家页那颗标题同一档（见 androidPhoneFit.css ⑥）。 */
                data-folia-safe-top="shift"
                className={`group/grid-title absolute left-1/2 top-5 -translate-x-1/2 z-[70] text-center flex flex-col items-center select-none transition-all px-5 py-2 rounded-2xl backdrop-blur-md ${hasCutInPanel ? 'cursor-pointer hover:scale-[1.01] active:scale-98' : ''}`}
                style={{
                    backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                    color: 'var(--text-primary)',
                }}
            >
                <h2 className="text-lg font-bold tracking-tight flex items-center gap-1.5 justify-center">
                    {heading}
                    {hasCutInPanel && <GridPanelToggleIndicator isOpen={isCutInPanelOpen} />}
                </h2>
                {(description || subtitle) && (
                    <p className="mt-0.5 max-w-[min(40rem,calc(100vw-8rem))] text-xs leading-relaxed opacity-50 line-clamp-2 whitespace-normal break-words">
                        {description || subtitle}
                    </p>
                )}
            </div>
        </>
    );
};

export default GridViewChrome;
