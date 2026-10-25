import React from 'react';
import { Heart, MirrorRectangular, Pause, Play, Repeat, Repeat1, RepeatOff, SkipBack, SkipForward, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RemoteControlSnapshot } from '../../types/remoteControl';
import { sendRemoteCommand } from './remoteWindowBridge';
import {
    formatTime,
    secondaryActiveClass,
    secondaryAlertClass,
    secondaryButtonBase,
    secondaryIdleClass,
    transportButtonClass,
} from './remoteCardVisuals';
import { Button } from '../ui';

// src/components/remote/RemoteTransportBar.tsx
// 播放面板下半截：左右两行时间戳，加一条「上一首 / 播放 / 下一首 / 循环 —— 喜欢 / 透明控制 /
// 导出」的控制行。只在指针在窗口里时显示；闲置时整个让位给歌词覆盖层（见 RemoteControlApp）。

type RemoteTransportBarProps = {
    isDaylight: boolean;
    snapshot: RemoteControlSnapshot;
    isPlaying: boolean;
    primaryDisabled: boolean;
    likeDisabled: boolean;
    /** 平台不支持收藏时给鼠标悬停看的说明；为空表示可以收藏。 */
    likeUnavailableReason: string | undefined;
    progressValue: number;
    duration: number;
    /** 录制中时导出键走告警色并呼吸。 */
    isExporting: boolean;
    onHoverNavSideChange: (side: 'prev' | 'next' | null) => void;
    onNavigate: (direction: 'prev' | 'next') => void;
    onOpenTransparentControls: () => void;
    onOpenExport: () => void;
};

const RemoteTransportBar: React.FC<RemoteTransportBarProps> = ({
    isDaylight,
    snapshot,
    isPlaying,
    primaryDisabled,
    likeDisabled,
    likeUnavailableReason,
    progressValue,
    duration,
    isExporting,
    onHoverNavSideChange,
    onNavigate,
    onOpenTransparentControls,
    onOpenExport,
}) => {
    const { t } = useTranslation();

    return (
        <div className="absolute inset-0 flex flex-col justify-between">
            {/* Timestamps */}
            <div className={`flex justify-between text-[10px] tabular-nums transition-colors ${isDaylight ? 'text-black/35' : 'text-white/30'
                }`}>
                <span>{formatTime(progressValue)}</span>
                <span>{formatTime(duration)}</span>
            </div>

            {/* Playback Actions */}
            <div className="flex w-full items-center justify-between">
                {/* Playback domain: transport with loop mode trailing it */}
                <div className="flex items-center gap-0.5">
                    <Button
                        tip={t('remote.previous')}
                        disabled={primaryDisabled || !snapshot.canGoPrevious}
                        onMouseEnter={() => onHoverNavSideChange('prev')}
                        onMouseLeave={() => onHoverNavSideChange(null)}
                        onClick={() => onNavigate('prev')}
                        className={transportButtonClass(isDaylight)}
                    >
                        <SkipBack size={17} strokeWidth={2} />
                    </Button>
                    <Button
                        tip={isPlaying ? t('remote.pause') : t('remote.play')}
                        disabled={primaryDisabled}
                        onClick={() => sendRemoteCommand({ type: 'play-pause' })}
                        className={`flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30 ${isDaylight
                            ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                            : 'bg-white text-zinc-950 hover:bg-white/90'
                            }`}
                    >
                        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} className="translate-x-0.5" fill="currentColor" />}
                    </Button>
                    <Button
                        tip={t('remote.next')}
                        disabled={primaryDisabled || !snapshot.canGoNext}
                        onMouseEnter={() => onHoverNavSideChange('next')}
                        onMouseLeave={() => onHoverNavSideChange(null)}
                        onClick={() => onNavigate('next')}
                        className={transportButtonClass(isDaylight)}
                    >
                        <SkipForward size={17} strokeWidth={2} />
                    </Button>
                    <Button
                        tip={snapshot.loopMode === 'off' ? t('remote.loopOff') : snapshot.loopMode === 'one' ? t('remote.loopOne') : t('remote.loopAll')}
                        aria-pressed={snapshot.loopMode !== 'off'}
                        disabled={primaryDisabled}
                        onClick={() => sendRemoteCommand({ type: 'cycle-loop-mode' })}
                        className={`${secondaryButtonBase} ml-2 ${snapshot.loopMode !== 'off' ? secondaryActiveClass(isDaylight) : secondaryIdleClass(isDaylight)}`}
                    >
                        {snapshot.loopMode === 'off' ? <RepeatOff size={15} strokeWidth={2} /> : snapshot.loopMode === 'one' ? <Repeat1 size={15} strokeWidth={2} /> : <Repeat size={15} strokeWidth={2} />}
                    </Button>
                </div>

                {/* Track reaction, then window tools */}
                <div className="flex items-center gap-0.5">
                    <span className="flex" title={likeUnavailableReason || (snapshot.isLiked ? t('remote.unlike') : t('remote.like'))}>
                        <Button
                            aria-label={likeUnavailableReason || (snapshot.isLiked ? t('remote.unlike') : t('remote.like'))}
                            aria-pressed={snapshot.isLiked}
                            disabled={likeDisabled}
                            onClick={() => sendRemoteCommand({ type: 'toggle-like' })}
                            className={`${secondaryButtonBase} ${snapshot.isLiked ? secondaryAlertClass(isDaylight) : secondaryIdleClass(isDaylight)}`}
                        >
                            <Heart size={15} fill={snapshot.isLiked ? 'currentColor' : 'none'} strokeWidth={2} />
                        </Button>
                    </span>
                    <Button
                        tip={t('remote.transparentControls')}
                        onClick={onOpenTransparentControls}
                        className={`${secondaryButtonBase} ml-2 ${secondaryIdleClass(isDaylight)}`}
                    >
                        <MirrorRectangular size={15} strokeWidth={2} />
                    </Button>
                    <Button
                        tip={t('remote.videoExport')}
                        disabled={!snapshot.hasTrack}
                        onClick={onOpenExport}
                        className={`${secondaryButtonBase} ${isExporting ? `${secondaryAlertClass(isDaylight)} animate-pulse` : secondaryIdleClass(isDaylight)}`}
                    >
                        <Video size={15} strokeWidth={2} />
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default RemoteTransportBar;
