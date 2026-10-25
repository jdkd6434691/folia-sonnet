import React from 'react';
import { useTranslation } from 'react-i18next';
import { REMOTE_NO_DRAG_STYLE, sendRemoteCommand } from './remoteWindowBridge';
import { TextField } from '../ui';

// src/components/remote/RemoteProgressSlider.tsx
// 播放面板顶上那条进度：3px 的轨道 + 一条不透明度为 0 的 range 盖在上面吃点击
// （range 自带 20px 高的命中区，比 3px 的轨道好按得多），外加只在音频过渡期间亮一下的辉光。
//
// 拖动期间不发命令，只记下待跳转的时间：快照每 500ms 推一次，拖到一半发 seek 会被
// 下一帧快照把进度条拽回去。松手（或回车）才真正发。

type RemoteProgressSliderProps = {
    isDaylight: boolean;
    /** 封面铺满整卡时，轨道压在封面上，走白色半透明。 */
    isSleeve: boolean;
    progressValue: number;
    duration: number;
    progressPercent: number;
    isTransitionGlowActive: boolean;
    /** 昼夜两套辉光色；与封面取色无关，走的是文字与背景的对比色。 */
    glowColor: string;
    disabled: boolean;
    pendingSeek: number | null;
    onPendingSeek: (value: number | null) => void;
    isDraggingRef: React.MutableRefObject<boolean>;
    lastSeekTimeRef: React.MutableRefObject<number>;
};

const RemoteProgressSlider: React.FC<RemoteProgressSliderProps> = ({
    isDaylight,
    isSleeve,
    progressValue,
    duration,
    progressPercent,
    isTransitionGlowActive,
    glowColor,
    disabled,
    pendingSeek,
    onPendingSeek,
    isDraggingRef,
    lastSeekTimeRef,
}) => {
    const { t } = useTranslation();

    const trackClass = isSleeve
        ? 'bg-white/30'
        : isDaylight ? 'bg-black/10' : 'bg-white/15';
    const fillClass = isSleeve
        ? 'bg-white'
        : isDaylight ? 'bg-[#1c1917]' : 'bg-white';

    return (
        <div className="w-full">
            <div className="relative w-full h-5 flex items-center" style={REMOTE_NO_DRAG_STYLE}>
                {/* Visible Track Background */}
                <div className={`w-full h-[3px] rounded-full transition-colors overflow-hidden ${trackClass}`}>
                    {/* Visible Progress Fill */}
                    <div
                        className={`h-full rounded-full transition-all duration-75 ${fillClass}`}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                {/* Glow only while the audio transition cue is active. */}
                {isTransitionGlowActive && (
                    <div
                        aria-hidden
                        className="remote-progress-transition-glow pointer-events-none absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                        style={{
                            width: `${progressPercent}%`,
                            backgroundColor: isSleeve ? '#ffffff' : glowColor,
                            ['--transition-glow-color' as string]: glowColor,
                        } as React.CSSProperties}
                    />
                )}

                {/* Transparent Large Hitbox Input Range */}
                <TextField
                    aria-label={t('ui.seek')}
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.1}
                    value={progressValue}
                    disabled={disabled || duration <= 0}
                    onChange={(event) => onPendingSeek(Number(event.currentTarget.value))}
                    onPointerDown={() => {
                        isDraggingRef.current = true;
                    }}
                    onPointerCancel={() => {
                        isDraggingRef.current = false;
                    }}
                    onPointerUp={() => {
                        isDraggingRef.current = false;
                        lastSeekTimeRef.current = Date.now();
                        if (pendingSeek !== null) {
                            sendRemoteCommand({ type: 'seek', time: pendingSeek });
                        }
                    }}
                    onKeyUp={(event) => {
                        if (event.key === 'Enter' && pendingSeek !== null) {
                            isDraggingRef.current = false;
                            lastSeekTimeRef.current = Date.now();
                            sendRemoteCommand({ type: 'seek', time: pendingSeek });
                        }
                    }}
                    className="absolute inset-x-0 h-5 w-full appearance-none cursor-pointer bg-transparent opacity-0 z-10 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-transparent"
                />
            </div>
        </div>
    );
};

export default RemoteProgressSlider;
