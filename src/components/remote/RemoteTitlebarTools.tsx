import React, { useEffect, useState } from 'react';
import { Palette, Pin, PinOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { REMOTE_DRAG_STYLE, REMOTE_NO_DRAG_STYLE } from './remoteWindowBridge';
import type { RemoteBackgroundMode } from './RemoteCardSurface';
import { Button } from '../ui';

// src/components/remote/RemoteTitlebarTools.tsx
// 卡片右上那三颗窗口工具：背景模式、置顶、关闭。连同外面那层拖拽区一起 —— 拖拽区
// 就在卡片顶上 44px，三颗键必须显式退出拖拽，否则按下去是在拖窗口。
// 「置顶」的真实状态在这一层自己订阅和回写，外面没有第二个地方用它。

type RemoteTitlebarToolsProps = {
    backgroundMode: RemoteBackgroundMode;
    isDaylight: boolean;
    /** 指针靠近顶部（或焦点落在这组键上）时才露出来。 */
    revealed: boolean;
    onKeepRevealed: () => void;
    /** 封面铺满整卡时，这一组也压在封面上，一律用白。 */
    isSleeve: boolean;
    /** 背景模式要落盘、还要喂给取色和背景层，所以循环动作留在外面。 */
    onCycleBackgroundMode: () => void;
};

const RemoteTitlebarTools: React.FC<RemoteTitlebarToolsProps> = ({
    backgroundMode,
    isDaylight,
    revealed,
    onKeepRevealed,
    isSleeve,
    onCycleBackgroundMode,
}) => {
    const { t } = useTranslation();
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);

    useEffect(() => {
        let mounted = true;
        void window.electron?.getRemoteControlAlwaysOnTop?.().then(nextAlwaysOnTop => {
            if (mounted) {
                setAlwaysOnTop(Boolean(nextAlwaysOnTop));
            }
        });
        return () => { mounted = false; };
    }, []);

    const handleToggleAlwaysOnTop = () => {
        const nextAlwaysOnTop = !alwaysOnTop;
        setAlwaysOnTop(nextAlwaysOnTop);
        void window.electron?.setRemoteControlAlwaysOnTop?.(nextAlwaysOnTop).then(actualAlwaysOnTop => {
            setAlwaysOnTop(Boolean(actualAlwaysOnTop));
        }).catch(() => {
            setAlwaysOnTop(!nextAlwaysOnTop);
        });
    };

    const toolClass = `flex h-6 w-6 items-center justify-center rounded-full transition ${isSleeve
        ? 'text-white/70 hover:bg-white/15 hover:text-white'
        : isDaylight
            ? 'text-black/30 hover:bg-black/10 hover:text-black/80'
            : 'text-white/30 hover:bg-white/10 hover:text-white/80'
        }`;

    return (
        <div
            className="absolute inset-x-0 top-0 z-20 h-11"
            style={REMOTE_DRAG_STYLE}
        >
            <div
                className={`absolute right-2.5 top-2.5 flex items-center gap-1 transition duration-200 ${revealed ? 'opacity-100' : 'opacity-0'
                    }`}
                style={{
                    ...REMOTE_NO_DRAG_STYLE,
                    pointerEvents: revealed ? 'auto' : 'none',
                }}
                onFocus={onKeepRevealed}
                onMouseEnter={onKeepRevealed}
            >
                <Button
                    tip={
                        backgroundMode === 'default' ? t('remote.backgroundDefault') :
                            backgroundMode === 'cover' ? t('remote.backgroundCover') :
                                t('remote.backgroundTransparent')
                    }
                    tabIndex={revealed ? 0 : -1}
                    onClick={() => {
                        // 循环交给外面：背景模式要落盘，也要喂给取色和背景层。
                        onCycleBackgroundMode();
                    }}
                    className={toolClass}
                >
                    <Palette size={13} />
                </Button>
                <Button
                    tip={alwaysOnTop ? t('remote.unpin') : t('remote.pinToFront')}
                    aria-pressed={alwaysOnTop}
                    tabIndex={revealed ? 0 : -1}
                    onClick={handleToggleAlwaysOnTop}
                    className={toolClass}
                >
                    {alwaysOnTop ? <Pin size={13} /> : <PinOff size={13} />}
                </Button>
                <Button
                    tip={t('remote.close')}
                    tabIndex={revealed ? 0 : -1}
                    onClick={() => void window.electron?.closeRemoteControl?.()}
                    className={toolClass}
                >
                    <X size={13} />
                </Button>
            </div>
        </div>
    );
};

export default RemoteTitlebarTools;
