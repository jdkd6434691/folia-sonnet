import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsRow from './SettingsRow';
import { settingsDividerClassFor } from './settingsCardClasses';
import { Button, RangeInput, Toggle } from './kit';
import { WALLPAPER } from './pages/appearance/options';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { isCapacitorAndroid } from '../../../platform/runtime';
import {
    getWallpaperLockScreenStatus,
    getWallpaperOverlayEventLog,
    hasWallpaperOverlayPermission,
    openRomPermissionPage,
    openWallpaperOverlaySettings,
    type WallpaperLockScreenStatus,
} from '../../../platform/foliaWallpaper';
import { Button as UiButton } from '@/components/ui';

// src/components/modal/settings/LyricsWallpaperOverlayRows.tsx
// 可视化叠层那一段：权限入口、总开关、透明度，以及锁屏 / 暂停 / 无歌词时的显隐，
// 还有锁屏起不来时的自诊断和 ROM 引导。从 LyricsWallpaperSettingsSection 拆出。

const LyricsWallpaperOverlayRows: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const dividerClass = settingsDividerClassFor(isDaylight);
    const isAndroid = isCapacitorAndroid();
    /*
     * 「次要动作」那颗按钮的底：白底 / 黑底两套。它跟实验室那颗是同一个长相，但那边
     * 是组件内的局部变量，这边拿不到，所以就地照抄一份 —— 不抽出去共享，是因为那颗
     * 还带着自己的圆角与内边距，两边尺寸并不一样。
     */
    const utilityGhostButtonClass = isDaylight
        ? 'border-zinc-300 bg-white/50 hover:bg-white/80'
        : 'border-white/10 bg-white/5 hover:bg-white/10';
    const wallpaperOverlayEnabled = useVisualizerSettingsStore(state => state.wallpaperOverlayEnabled);
    const onToggleWallpaperOverlayEnabled = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayEnabled);
    const wallpaperOverlayLockScreen = useVisualizerSettingsStore(state => state.wallpaperOverlayLockScreen);
    const onToggleWallpaperOverlayLockScreen = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayLockScreen);
    const wallpaperOverlayLockScreenOnly = useVisualizerSettingsStore(state => state.wallpaperOverlayLockScreenOnly);
    const onToggleWallpaperOverlayLockScreenOnly = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayLockScreenOnly);
    const wallpaperOverlayOpacity = useVisualizerSettingsStore(state => state.wallpaperOverlayOpacity);
    const onSetWallpaperOverlayOpacity = useVisualizerSettingsStore(state => state.handleSetWallpaperOverlayOpacity);
    const wallpaperOverlayAllApps = useVisualizerSettingsStore(state => state.wallpaperOverlayAllApps);
    const onToggleWallpaperOverlayAllApps = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayAllApps);
    const wallpaperOverlayHideNativeLyrics = useVisualizerSettingsStore(state => state.wallpaperOverlayHideNativeLyrics);
    const onToggleWallpaperOverlayHideNativeLyrics = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideNativeLyrics);
    const wallpaperOverlayHideNativeProgress = useVisualizerSettingsStore(state => state.wallpaperOverlayHideNativeProgress);
    const onToggleWallpaperOverlayHideNativeProgress = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideNativeProgress);
    const wallpaperOverlaySkipInstrumental = useVisualizerSettingsStore(state => state.wallpaperOverlaySkipInstrumental);
    const onToggleWallpaperOverlaySkipInstrumental = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlaySkipInstrumental);
    const wallpaperOverlayHideWhenPaused = useVisualizerSettingsStore(state => state.wallpaperOverlayHideWhenPaused);
    const onToggleWallpaperOverlayHideWhenPaused = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideWhenPaused);
    const wallpaperOverlayHideAfterLyricsEnd = useVisualizerSettingsStore(state => state.wallpaperOverlayHideAfterLyricsEnd);
    const onToggleWallpaperOverlayHideAfterLyricsEnd = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideAfterLyricsEnd);
    const wallpaperOverlayHideCoverArt = useVisualizerSettingsStore(state => state.wallpaperOverlayHideCoverArt);
    const onToggleWallpaperOverlayHideCoverArt = useVisualizerSettingsStore(state => state.handleToggleWallpaperOverlayHideCoverArt);

    /*
     * 音乐锁屏的自诊断。
     *
     * 「后台启动 Activity 被系统拦」是**静默**的：不抛异常、不返回失败码，
     * 而真机上的 logcat 基本取不到。没有这一行提示，用户只能对着一个没反应的
     * 开关猜到底是没到时机（还没熄屏过），还是被系统 / ROM 挡住了。
     */
    const [lockScreenStatus, setLockScreenStatus] =
        React.useState<WallpaperLockScreenStatus | null>(null);
    // 「仅在锁屏显示」也会把锁屏页带起来，所以诊断对它同样有意义。
    const lockScreenActive = wallpaperOverlayLockScreen || wallpaperOverlayLockScreenOnly;
    useEffect(() => {
        if (!lockScreenActive) {
            setLockScreenStatus(null);
            return;
        }
        let cancelled = false;
        const load = async () => {
            const status = await getWallpaperLockScreenStatus();
            if (!cancelled) setLockScreenStatus(status);
        };
        void load();
        const timer = window.setInterval(() => void load(), 4000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [lockScreenActive]);

    /*
     * 叠层最近做了什么（新的在前）。
     *
     * 「叠层放着放着突然消失、然后又淡入」在代码里至少有四条完全不同的来路 ——
     * 窗口淡出、整页重载（设置变了 / 自愈觉得页面坏了）、息屏摘窗口、被系统悄悄摘窗口 ——
     * 画面上四条一模一样，而真机上的 logcat 基本取不到（很多 ROM 根本不给读）。
     * 所以让原生把「动作 + 当时为什么」记成一串短行，这里读出来直接摆给用户看，
     * 不用再靠描述现象猜。只在叠层开着时轮询。
     */
    const [overlayEventLog, setOverlayEventLog] = React.useState<string[]>([]);
    useEffect(() => {
        if (!wallpaperOverlayEnabled || !isCapacitorAndroid()) {
            setOverlayEventLog([]);
            return;
        }
        let cancelled = false;
        const load = async () => {
            const events = await getWallpaperOverlayEventLog();
            if (!cancelled) setOverlayEventLog(events);
        };
        void load();
        const timer = window.setInterval(() => void load(), 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [wallpaperOverlayEnabled]);

    // 可视化叠层要「显示在其他应用上层」权限，没授权时它是静默不启用的。
    const [hasOverlayPermission, setHasOverlayPermission] = useState(false);

    useEffect(() => {
        if (!isAndroid) return;
        let cancelled = false;
        void hasWallpaperOverlayPermission().then((granted) => {
            if (!cancelled) setHasOverlayPermission(granted);
        });
        return () => {
            cancelled = true;
        };
    }, [isAndroid]);

    const handleOpenOverlaySettings = () => {
        void openWallpaperOverlaySettings();
        // 授权页是系统界面，用户回来之后才生效，延后复查一次。
        window.setTimeout(() => {
            void hasWallpaperOverlayPermission().then(setHasOverlayPermission);
        }, 3000);
    };

    return (
        <>
            {/* 可视化叠层要 SYSTEM_ALERT_WINDOW；没授权时它静默不工作，
                用户只会看到「壁纸跟以前一样」，所以这里必须给明确入口。 */}
            <SettingsRow
                option={WALLPAPER.overlay}
                dividerClass={dividerClass}
                control={(
                    <Button onClick={handleOpenOverlaySettings}>
                        {hasOverlayPermission
                            ? t('options.lyricsWallpaperOverlayGranted')
                            : t('options.lyricsWallpaperOverlayGrant')}
                    </Button>
                )}
            />
            {/* 叠层总开关：关掉之后一层都不挂，下面几项也就没有意义了。 */}
            <SettingsRow
                option={WALLPAPER.overlayEnabled}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayEnabled} onChange={onToggleWallpaperOverlayEnabled} />
                )}
            />
            {/* 叠层不透明度：整层从几乎看不见到完全不透明。 */}
            <SettingsRow
                option={WALLPAPER.overlayOpacity}
                dividerClass={dividerClass}
                control={(
                    <div className="flex items-center gap-2">
                        <RangeInput
                            min={10}
                            max={100}
                            step={5}
                            value={Math.round(wallpaperOverlayOpacity * 100)}
                            onChange={value => onSetWallpaperOverlayOpacity(value / 100)}
                            className="h-1 w-28 cursor-pointer accent-white"
                        />
                        <span className="w-9 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {Math.round(wallpaperOverlayOpacity * 100)}%
                        </span>
                    </div>
                )}
            />
            {/* 叠层是否在所有应用之上显示。 */}
            <SettingsRow
                option={WALLPAPER.overlayAllApps}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayAllApps} onChange={onToggleWallpaperOverlayAllApps} />
                )}
            />
            {/* 音乐锁屏：锁屏之上也挂同一层。 */}
            <SettingsRow
                option={WALLPAPER.overlayLockScreen}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayLockScreen} onChange={onToggleWallpaperOverlayLockScreen} />
                )}
            />
            {/* 叠层只在锁屏上出现：桌面 / 所有应用 / App 内都不挂。 */}
            <SettingsRow
                option={WALLPAPER.overlayLockScreenOnly}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayLockScreenOnly} onChange={onToggleWallpaperOverlayLockScreenOnly} />
                )}
            />
            {lockScreenActive && lockScreenStatus && (
                <p
                    className="px-4 pb-3 text-xs leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {lockScreenStatus.blocked
                        ? t('options.wallpaperOverlayLockScreenBlocked')
                        : (lockScreenStatus.hosted || lockScreenStatus.started)
                            ? t('options.wallpaperOverlayLockScreenReady')
                            : t('options.wallpaperOverlayLockScreenWaiting')}
                </p>
            )}
            {lockScreenActive && lockScreenStatus?.lastExit && (
                <p
                    className="px-4 pb-3 text-xs leading-relaxed opacity-70"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {t('options.wallpaperOverlayLockScreenLastExit')}{lockScreenStatus.lastExit}
                </p>
            )}
            {/*
             * ROM 引导：锁屏页起不来时，绝大多数是 ROM 那几道开关没开。
             *
             * 代码绕不过去（没有任何调用能替用户授权），只能把人送到正确的页面 ——
             * 所以这里在「被拦了 / 试过但一直没起来」时才出现，平时不占地方。
             */}
            {lockScreenActive && lockScreenStatus && (lockScreenStatus.blocked
                || (!lockScreenStatus.hosted && !lockScreenStatus.started
                    && lockScreenStatus.attempts > 0)) && (
                <div className="px-4 pb-3">
                    <p
                        className="text-xs leading-relaxed"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {lockScreenStatus.rom
                            ? t('options.wallpaperOverlayLockScreenRomHint', { rom: lockScreenStatus.rom })
                            : t('options.wallpaperOverlayLockScreenGenericHint')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <UiButton
                            onClick={handleOpenOverlaySettings}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {hasOverlayPermission
                                ? t('options.lyricsWallpaperOverlayGranted')
                                : t('options.lyricsWallpaperOverlayGrant')}
                        </UiButton>
                        <UiButton
                            onClick={() => void openRomPermissionPage('background')}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {t('options.wallpaperOverlayLockScreenOpenBackground')}
                        </UiButton>
                        <UiButton
                            onClick={() => void openRomPermissionPage('power')}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {t('options.wallpaperOverlayLockScreenOpenPower')}
                        </UiButton>
                    </div>
                </div>
            )}
            {/* 叠层的动作流水：只给「为什么突然消失」这类问题用，所以折叠起来，
                平时不占地方。新的在前，最多 40 条（原生那边是个环形缓冲）。 */}
            {overlayEventLog.length > 0 && (
                <details className="px-4 pb-3">
                    <summary
                        className="cursor-pointer text-xs leading-relaxed opacity-70"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {t('options.wallpaperOverlayEventLog', { count: overlayEventLog.length })}
                    </summary>
                    <pre
                        className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-all rounded-lg px-2 py-1.5 font-mono text-[10px] leading-relaxed"
                        style={{
                            color: 'var(--text-secondary)',
                            backgroundColor: 'color-mix(in srgb, var(--text-primary) 6%, transparent)',
                        }}
                    >
                        {overlayEventLog.join('\n')}
                    </pre>
                </details>
            )}
            {/* 跟随 + 叠层时，原生那层的歌词/进度条要不要让位。 */}
            <SettingsRow
                option={WALLPAPER.overlayHideNativeLyrics}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayHideNativeLyrics} onChange={onToggleWallpaperOverlayHideNativeLyrics} />
                )}
            />
            {/* 暂停时是否收起叠层。 */}
            <SettingsRow
                option={WALLPAPER.overlayHideWhenPaused}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayHideWhenPaused} onChange={onToggleWallpaperOverlayHideWhenPaused} />
                )}
            />
            {/* 歌词唱完之后（长尾奏）是否收起叠层。 */}
            <SettingsRow
                option={WALLPAPER.overlayHideAfterLyricsEnd}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayHideAfterLyricsEnd} onChange={onToggleWallpaperOverlayHideAfterLyricsEnd} />
                )}
            />
            {/*
              叠层里的封面要不要显示。

              默认隐藏：封面是一整块不透明的方形图，挂在叠层上就把底下的原生壁纸
              糊掉一大块，而叠层存在的意义恰恰是透出壁纸。想要莫奈那套完整构图的
              再关掉这一项。
            */}
            <SettingsRow
                option={WALLPAPER.overlayHideCoverArt}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayHideCoverArt} onChange={onToggleWallpaperOverlayHideCoverArt} />
                )}
            />
            {/* 纯音乐（没有歌词）时是否显示叠层。 */}
            <SettingsRow
                option={WALLPAPER.overlaySkipInstrumental}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlaySkipInstrumental} onChange={onToggleWallpaperOverlaySkipInstrumental} />
                )}
            />
            <SettingsRow
                option={WALLPAPER.overlayHideNativeProgress}
                dividerClass={dividerClass}
                control={(
                    <Toggle checked={wallpaperOverlayHideNativeProgress} onChange={onToggleWallpaperOverlayHideNativeProgress} />
                )}
            />
        </>
    );
};

export default LyricsWallpaperOverlayRows;
