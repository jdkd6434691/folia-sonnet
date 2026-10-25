import React from 'react';
import { Lock, LockOpen, Pin, PinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RemoteControlSnapshot } from '../../types/remoteControl';
import { sendRemoteCommand } from './remoteWindowBridge';
import { Button } from '../ui';

// src/components/remote/RemoteTransparentControls.tsx
// 遥控窗口里控制「主窗口」的那一面板：主窗口走常规还是透明、它的控件条怎么显隐、
// 边框要不要、鼠标穿透与主窗口置顶。两排各两格，格子里是胶囊状的开关。
// 注意这里发的命令全部作用于主窗口，不是遥控窗口自己。

/** 一段二选一：选中走实心，未选中走浅底。 */
const segmentClass = (isDaylight: boolean, selected: boolean) => (selected
    ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
    : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white'));

/** 整格按钮：开着的走实心，关着的走浅底 + 描边。 */
const tileClass = (isDaylight: boolean, on: boolean) => `flex h-8 items-center justify-center rounded-xl text-[11px] font-bold transition border ${on
    ? (isDaylight ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm' : 'bg-white border-white text-zinc-950 shadow-sm')
    : (isDaylight ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white')
    }`;

type RemoteTransparentControlsProps = {
    isDaylight: boolean;
    snapshot: RemoteControlSnapshot;
};

const RemoteTransparentControls: React.FC<RemoteTransparentControlsProps> = ({ isDaylight, snapshot }) => {
    const { t } = useTranslation();

    return (
        <div className="w-full flex flex-col gap-2.5">
            {/* Row 1: Regular/Transparent mode segment control and Player Chrome visibility */}
            <div className="grid grid-cols-2 gap-2.5">
                <div className={`flex h-8 rounded-xl p-0.5 transition-colors ${isDaylight ? 'bg-black/5' : 'bg-white/5'}`}>
                    <Button
                        onClick={() => sendRemoteCommand({ type: 'set-transparent-mode-enabled', enabled: false })}
                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition ${segmentClass(isDaylight, !snapshot.transparentModeEnabled)}`}
                    >
                        {t('remote.standard')}
                    </Button>
                    <Button
                        onClick={() => sendRemoteCommand({ type: 'set-transparent-mode-enabled', enabled: true })}
                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition ${segmentClass(isDaylight, snapshot.transparentModeEnabled)}`}
                    >
                        {t('remote.transparent')}
                    </Button>
                </div>

                <Button
                    onClick={() => sendRemoteCommand({ type: 'cycle-player-chrome-visibility-mode' })}
                    className={tileClass(isDaylight, snapshot.playerChromeVisibilityMode === 'always-hidden')}
                >
                    {t(snapshot.playerChromeVisibilityMode === 'always-hidden'
                        ? 'remote.uiAlwaysHidden'
                        : snapshot.playerChromeVisibilityMode === 'always-visible'
                            ? 'remote.uiAlwaysVisible'
                            : 'remote.uiAutoHide')}
                </Button>
            </div>

            {/* Row 2: Main window border and Click-through controls */}
            <div className="grid grid-cols-2 gap-2.5">
                <Button
                    onClick={() => sendRemoteCommand({ type: 'set-main-window-border-visible', visible: !snapshot.mainWindowBorderVisible })}
                    className={tileClass(isDaylight, snapshot.mainWindowBorderVisible)}
                >
                    {snapshot.mainWindowBorderVisible ? t('remote.hideBorder') : t('remote.showBorder')}
                </Button>

                <div className={`grid h-8 grid-cols-2 overflow-hidden rounded-xl border transition-colors ${isDaylight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-white/5'
                    }`}>
                    {/*
                     * 鼠标穿透要先开透明模式：常规模式下窗口是不透明的，穿透了也只能看见一块挡板。
                     * 所以这一格在未开透明模式时禁用。
                     */}
                    <Button
                        disabled={!snapshot.transparentModeEnabled}
                        tip={snapshot.mainWindowClickThroughEnabled ? t('remote.disableClickThrough') : t('remote.enableClickThrough')}
                        aria-pressed={snapshot.mainWindowClickThroughEnabled}
                        onClick={() => sendRemoteCommand({ type: 'set-main-window-click-through', enabled: !snapshot.mainWindowClickThroughEnabled })}
                        className={`flex h-full items-center justify-center gap-1 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${snapshot.mainWindowClickThroughEnabled
                            ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                            : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                            }`}
                    >
                        {snapshot.mainWindowClickThroughEnabled ? <Lock size={12} /> : <LockOpen size={12} />}
                        <span>{t('remote.through')}</span>
                    </Button>
                    <Button
                        tip={snapshot.mainWindowAlwaysOnTop ? t('remote.unpinMainWindow') : t('remote.pinMainWindow')}
                        aria-pressed={snapshot.mainWindowAlwaysOnTop}
                        onClick={() => sendRemoteCommand({ type: 'set-main-window-always-on-top', enabled: !snapshot.mainWindowAlwaysOnTop })}
                        className={`flex h-full items-center justify-center gap-1 border-l text-[10px] font-bold transition ${snapshot.mainWindowAlwaysOnTop
                            ? (isDaylight ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm' : 'border-white bg-white text-zinc-950 shadow-sm')
                            : (isDaylight ? 'border-black/5 text-black/70 hover:bg-black/5 hover:text-black' : 'border-white/5 text-white/70 hover:bg-white/5 hover:text-white')
                            }`}
                    >
                        {snapshot.mainWindowAlwaysOnTop ? <Pin size={12} /> : <PinOff size={12} />}
                        <span>{t('remote.pin')}</span>
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default RemoteTransparentControls;
