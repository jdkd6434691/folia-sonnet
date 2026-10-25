import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Cloud, Loader2, Search, Upload, X } from 'lucide-react';
import {
    fetchFontMarket,
    installMarketFont,
    readFontMarketChoice,
    resolveFontPreviewUrl,
    writeFontMarketChoice,
    type FontMarketFont,
    type FontMarketInstallResult,
} from '../../services/fontMarket';
import { Button, TextField } from '@/components/ui';

// src/components/modal/FontMarketDialog.tsx
// 字体市场：列出后台上架的字体，点一下预览，再点「使用」才去下载。
//
// 两个入口共用它 —— 壁纸 / 叠层的歌词字体，以及动画设置里的字体选择。
// 弹层走 createPortal 挂到 body：这两处各自的祖先层上都带
// pointer-events:none / aria-hidden 的不可见锚点，就地挂载会「弹出来却点不动」。
//
// 「打开有多快」是这里唯一的性能目标，分三步走：
//   1. 先要目录 —— 一份几 KB 的文本，拿到就立刻把卡片框子摆出来，不等任何图片；
//   2. 图片只在这一张快滚进屏幕时才开始下载；
//   3. 目录按页取，滚到底再要下一页。
// 于是点开市场的等待时间只等于一次小 JSON 的往返，图片在后面慢慢补上。

export interface FontMarketSelection {
    id: string;
    family: string;
    label: string;
    previewUrl: string;
}

interface FontMarketDialogProps {
    isOpen: boolean;
    onClose: () => void;
    isDaylight: boolean;
    /** 当前生效的 CSS family，用来打勾。 */
    currentFamily?: string | null;
    onUseFont: (result: FontMarketInstallResult) => void;
    onClearFont?: () => void;
    /** 有的入口（壁纸）走系统文件选择器，把这一路挂进来。 */
    onPickLocalFont?: () => void;
    localFontLabel?: string | null;
}

type TabId = 'all' | 'sans' | 'serif' | 'handwriting' | 'display' | 'mono' | 'mine';

const themeAccentSoft = (isDaylight: boolean): string => (
    isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'
);

/** 一页多少条。手机上两列差不多三屏 —— 一次够翻，又不至于一次拖几十张图。 */
const PAGE_SIZE = 24;

/** 首屏骨架画几张卡。够撑出「这是个网格」的第一印象就行。 */
const SKELETON_COUNT = 6;

/** 预览图是后台按 720×240 烤的；老条目拿不到比例时退回 3:1。 */
const FALLBACK_ASPECT = 3;

/** 滚动还剩多少就提前要下一页。比一行卡片多一点，滚快了也不至于看到空。 */
const PREFETCH_MARGIN = '320px 0px';

/**
 * 一张预览图。
 *
 * 两件事：
 *   · 图片快滚进屏幕了才开始下载，没滚到的不占带宽；
 *   · 下载期间用一个同样高的灰块顶着，加载完淡入 —— 位置一动不动。
 */
const FontPreviewImage: React.FC<{
    src: string;
    alt: string;
    aspect: number;
    barClass: string;
}> = ({ src, alt, aspect, barClass }) => {
    const holderRef = useRef<HTMLDivElement | null>(null);
    const [visible, setVisible] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const ratio = aspect > 0 ? aspect : FALLBACK_ASPECT;

    useEffect(() => {
        setVisible(false);
        setLoaded(false);
    }, [src]);

    useEffect(() => {
        const node = holderRef.current;
        if (!node) return undefined;
        /* 老 WebView 没有 IntersectionObserver：直接加载，总比什么都不显示强。 */
        if (typeof IntersectionObserver === 'undefined') {
            setVisible(true);
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setVisible(true);
                observer.disconnect();
            }
        }, { rootMargin: PREFETCH_MARGIN });
        observer.observe(node);
        return () => observer.disconnect();
    }, [src]);

    return (
        <div
            ref={holderRef}
            className="relative w-full overflow-hidden bg-white/[0.03]"
            /*
             * 用 padding 撑高而不是 `aspect-ratio`：后者要 Chrome 88+，
             * 而高度一旦撑不出来，每张图加载完都会把下面的卡片顶一下。
             */
            style={{ paddingTop: `${(100 / ratio).toFixed(4)}%` }}
        >
            {!loaded && <div className={`absolute inset-0 animate-pulse ${barClass}`} />}
            {visible && (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setLoaded(true)}
                    /* 图挂了也别一直转圈，留个空卡片给字体名。 */
                    onError={() => setLoaded(true)}
                    className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
                    style={{ opacity: loaded ? 1 : 0 }}
                />
            )}
        </div>
    );
};

/** 目录还没回来时先摆出来的空卡片。 */
const FontCardSkeleton: React.FC<{ cardClass: string; barClass: string }> = ({ cardClass, barClass }) => (
    <div className={`overflow-hidden rounded-2xl border ${cardClass}`} aria-hidden="true">
        <div
            className="relative w-full overflow-hidden"
            style={{ paddingTop: `${(100 / FALLBACK_ASPECT).toFixed(4)}%` }}
        >
            <div className={`absolute inset-0 animate-pulse ${barClass}`} />
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className={`h-3 w-2/3 animate-pulse rounded-full ${barClass}`} />
                <div className={`h-2.5 w-1/3 animate-pulse rounded-full ${barClass}`} />
            </div>
            <div className={`h-6 w-14 animate-pulse rounded-full ${barClass}`} />
        </div>
    </div>
);

const TABS: Array<{ id: TabId; labelKey: string; fallback: string }> = [
    { id: 'all', labelKey: 'options.fontMarketAll', fallback: '全部' },
    { id: 'sans', labelKey: 'options.fontMarketCategorySans', fallback: '黑体' },
    { id: 'serif', labelKey: 'options.fontMarketCategorySerif', fallback: '宋体' },
    { id: 'handwriting', labelKey: 'options.fontMarketCategoryHandwriting', fallback: '手写' },
    { id: 'display', labelKey: 'options.fontMarketCategoryDisplay', fallback: '艺术' },
    { id: 'mono', labelKey: 'options.fontMarketCategoryMono', fallback: '等宽' },
    { id: 'mine', labelKey: 'options.fontMarketMine', fallback: '我的' },
];

const FontMarketDialog: React.FC<FontMarketDialogProps> = ({
    isOpen,
    onClose,
    isDaylight,
    currentFamily,
    onUseFont,
    onClearFont,
    onPickLocalFont,
    localFontLabel,
}) => {
    const { t } = useTranslation();
    const [fonts, setFonts] = useState<FontMarketFont[]>([]);
    const [status, setStatus] = useState<'loading' | 'ready' | 'offline' | 'server'>('loading');
    const [query, setQuery] = useState('');
    /** 真正发出去的那个搜索词 —— 输入框里的字停了 300ms 才同步过来。 */
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [tab, setTab] = useState<TabId>('all');
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [moreError, setMoreError] = useState(false);
    const [preview, setPreview] = useState<FontMarketFont | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    /** 每次发起请求领一个号；回来的号不是最新的就丢掉 —— 切 tab 快了会有竞态。 */
    const requestRef = useRef(0);
    const pageRef = useRef(1);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => setSubmittedQuery(query.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [query]);

    const load = useCallback(async (targetPage: number, mode: 'replace' | 'append') => {
        const token = requestRef.current + 1;
        requestRef.current = token;
        if (mode === 'replace') setStatus('loading');
        else {
            setLoadingMore(true);
            setMoreError(false);
        }

        const result = await fetchFontMarket({
            page: targetPage,
            pageSize: PAGE_SIZE,
            category: tab === 'mine' ? 'all' : tab,
            q: submittedQuery,
        });

        /* 期间又发了新请求：这一份已经过期了。 */
        if (token !== requestRef.current) return;

        if (result.error) {
            setLoadingMore(false);
            /*
             * 翻页翻挂了别把已经显示着的列表也抹掉 —— 只在底部给个重试，
             * 用户往回滑还能正常看前面的。
             */
            if (mode === 'append') {
                setMoreError(true);
                return;
            }
            setFonts([]);
            setTotal(0);
            setHasMore(false);
            setStatus(result.error === 'offline' ? 'offline' : 'server');
            return;
        }

        pageRef.current = result.page;
        setTotal(result.total);
        setHasMore(result.hasMore);
        setFonts((current) => {
            if (mode === 'replace') return result.fonts;
            /* 快速滚动可能让同一页触发两次，按 id 去过重。 */
            const seen = new Set(current.map((font) => font.id));
            return [...current, ...result.fonts.filter((font) => !seen.has(font.id))];
        });
        setStatus('ready');
        setLoadingMore(false);
    }, [tab, submittedQuery]);

    useEffect(() => {
        if (!isOpen || tab === 'mine') return;
        pageRef.current = 1;
        void load(1, 'replace');
    }, [isOpen, tab, submittedQuery, load]);

    const loadMore = useCallback(() => {
        if (!hasMore || loadingMore || status !== 'ready') return;
        void load(pageRef.current + 1, 'append');
    }, [hasMore, loadingMore, status, load]);

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore || status !== 'ready') return;
        if (typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) loadMore();
        }, { rootMargin: PREFETCH_MARGIN });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, status, loadMore]);

    useEffect(() => {
        if (!isOpen) {
            setPreview(null);
            setNotice(null);
            setLoadingMore(false);
            setMoreError(false);
        }
    }, [isOpen]);

    const applyFont = async (font: FontMarketFont) => {
        if (busyId) return;
        setBusyId(font.id);
        setNotice(null);
        try {
            const result = await installMarketFont(font);
            writeFontMarketChoice({
                id: result.id,
                family: result.family,
                label: result.label,
                previewUrl: result.previewUrl,
            });
            onUseFont(result);
            setPreview(null);
            onClose();
        } catch (error) {
            setNotice(`${t('options.fontMarketInstallFailed')}${(error as Error)?.message ? `：${(error as Error).message}` : ''}`);
        } finally {
            setBusyId(null);
        }
    };

    if (!isOpen || typeof document === 'undefined') return null;

    const cardClass = isDaylight
        ? 'bg-black/[0.04] border-black/10'
        : 'bg-white/5 border-white/10';
    const dividerClass = isDaylight ? 'border-black/10' : 'border-white/10';
    const muted = isDaylight ? 'text-black/55' : 'text-white/55';
    const surfaceClass = isDaylight
        ? 'bg-white border-black/10'
        : 'bg-zinc-900 border-white/10';
    const barClass = isDaylight ? 'bg-black/10' : 'bg-white/10';

    return createPortal(
        <div
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-3 backdrop-blur-md"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            data-folia-font-market-overlay="true"
        >
            <div
                className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-[26px] border shadow-2xl ${surfaceClass}`}
                style={{ maxHeight: 'min(86vh, 760px)' }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={`flex items-center justify-between gap-3 border-b px-5 py-4 ${dividerClass}`}>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            <Cloud size={15} className="shrink-0 opacity-70" aria-hidden="true" />
                            {t('options.fontMarket')}
                        </div>
                        <div className={`text-xs ${muted}`}>
                            {status === 'ready' && total > 0
                                ? t('options.fontMarketCount', { count: total })
                                : t('options.fontMarketDesc')}
                        </div>
                    </div>
                    <Button
                        onClick={onClose}
                        aria-label={t('ui.close')}
                        className="shrink-0 rounded-full border border-white/10 bg-white/5 p-2 transition-colors hover:bg-white/10"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <X size={17} />
                    </Button>
                </div>

                <div className={`border-b px-5 py-3 ${dividerClass}`}>
                    <label className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                        <Search size={15} style={{ color: 'var(--text-secondary)' }} />
                        <TextField
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t('options.fontMarketSearch')}
                            className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
                            style={{ color: 'var(--text-primary)' }}
                        />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {TABS.map((entry) => {
                            const active = tab === entry.id;
                            return (
                                <Button
                                    key={entry.id}
                                    aria-pressed={active}
                                    onClick={() => setTab(entry.id)}
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-opacity ${isDaylight ? 'border-black/15' : 'border-white/15'} ${active ? 'opacity-100' : 'opacity-55 hover:opacity-85'}`}
                                    style={{
                                        color: 'var(--text-primary)',
                                        backgroundColor: active
                                            ? (themeAccentSoft(isDaylight))
                                            : 'transparent',
                                    }}
                                >
                                    {t(entry.labelKey) === entry.labelKey ? entry.fallback : t(entry.labelKey)}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    {tab === 'mine' ? (
                        <div className="space-y-3">
                            <div className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${muted} ${cardClass}`}>
                                {t('options.fontMarketMineDesc')}
                            </div>
                            <div className={`rounded-2xl border px-4 py-3 ${cardClass}`}>
                                <div className={`text-xs ${muted}`}>{t('options.currentFont')}</div>
                                <div className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {localFontLabel?.trim() || t('options.systemFontInactive')}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {onPickLocalFont && (
                                    <Button
                                        onClick={onPickLocalFont}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white/90"
                                    >
                                        <Upload size={14} />
                                        {t('options.fontMarketPickLocal')}
                                    </Button>
                                )}
                                {onClearFont && (
                                    <Button
                                        onClick={() => {
                                            writeFontMarketChoice(null);
                                            onClearFont();
                                            onClose();
                                        }}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-500/30 px-3.5 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/10"
                                    >
                                        {t('options.fontMarketClear')}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : status === 'loading' ? (
                        /*
                         * 目录还没回来就把网格的架子先摆出来：用户点开看到的是
                         * 「一面正在装的字体墙」，而不是一行转圈的字。
                         */
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                                <FontCardSkeleton key={index} cardClass={cardClass} barClass={barClass} />
                            ))}
                        </div>
                    ) : fonts.length === 0 ? (
                        <div className={`text-xs ${muted}`}>
                            {status === 'offline'
                                ? t('options.fontMarketOffline')
                                : status === 'server'
                                    ? t('options.fontMarketServerError')
                                    : t('options.fontMarketNoMatch')}
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {fonts.map((font) => {
                                    const active = currentFamily !== null
                                        && currentFamily !== undefined
                                        && currentFamily.trim() !== ''
                                        && currentFamily === font.family;
                                    return (
                                        <div
                                            key={font.id}
                                            className={`overflow-hidden rounded-2xl border ${cardClass}`}
                                        >
                                            <Button
                                                onClick={() => setPreview(font)}
                                                className="block w-full text-left"
                                            >
                                                <FontPreviewImage
                                                    src={resolveFontPreviewUrl(font)}
                                                    alt={font.name}
                                                    aspect={font.previewAspect}
                                                    barClass={barClass}
                                                />
                                            </Button>
                                            <div className="flex items-center gap-2 px-3.5 py-2.5">
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                        {font.name}
                                                    </div>
                                                    <div className={`truncate text-[11px] ${muted}`}>
                                                        {font.categoryLabel || font.category}
                                                    </div>
                                                </div>
                                                {active ? (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[11px]" style={{ color: 'var(--text-primary)' }}>
                                                        <Check size={11} />
                                                        {t('options.fontMarketUsing')}
                                                    </span>
                                                ) : (
                                                    <Button
                                                        disabled={busyId !== null}
                                                        onClick={() => void applyFont(font)}
                                                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-950 transition hover:bg-white/90 disabled:opacity-45"
                                                    >
                                                        {busyId === font.id ? <Loader2 size={11} className="animate-spin" /> : null}
                                                        {busyId === font.id ? t('options.fontMarketInstalling') : t('options.fontMarketUse')}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {hasMore ? (
                                /*
                                 * 哨兵：滚到底自动要下一页。老 WebView 没有
                                 * IntersectionObserver，就靠下面这个按钮兜底。
                                 */
                                <div ref={sentinelRef} className="flex justify-center pt-4">
                                    {loadingMore ? (
                                        <span className={`flex items-center gap-2 text-xs ${muted}`}>
                                            <Loader2 size={14} className="animate-spin" />
                                            {t('options.fontMarketLoadingMore')}
                                        </span>
                                    ) : (
                                        <Button
                                            onClick={() => void loadMore()}
                                            className={`rounded-full border px-4 py-2 text-xs font-medium transition-colors ${isDaylight ? 'border-black/15 hover:bg-black/5' : 'border-white/15 hover:bg-white/5'}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {moreError ? t('options.fontMarketRetry') : t('options.fontMarketLoadMore')}
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div className={`pt-4 text-center text-[11px] ${muted}`}>
                                    {t('options.fontMarketAllLoaded', { count: total })}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {notice && (
                    <div className={`border-t px-5 py-3 text-xs text-red-400 ${dividerClass}`}>{notice}</div>
                )}
            </div>

            {preview && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-black/70 p-5"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setPreview(null);
                    }}
                >
                    <div className={`w-full max-w-2xl overflow-hidden rounded-2xl border ${surfaceClass}`} onClick={(event) => event.stopPropagation()}>
                        <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${dividerClass}`}>
                            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{preview.name}</div>
                            <Button
                                onClick={() => setPreview(null)}
                                tip={t('ui.close')}
                                className="rounded-full border border-white/10 bg-white/5 p-1.5"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                <X size={15} />
                            </Button>
                        </div>
                        <img src={resolveFontPreviewUrl(preview)} alt={preview.name} className="block w-full" />
                        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 ${dividerClass}`}>
                            <div className={`text-[11px] ${muted}`}>
                                {[preview.categoryLabel || preview.category, preview.license].filter(Boolean).join(' · ')}
                            </div>
                            <Button
                                disabled={busyId !== null}
                                onClick={() => void applyFont(preview)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white/90 disabled:opacity-45"
                            >
                                {busyId === preview.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                {busyId === preview.id ? t('options.fontMarketInstalling') : t('options.fontMarketConfirm')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body,
    );
};

export default FontMarketDialog;
