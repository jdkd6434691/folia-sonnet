import React from 'react';
import { AnimatePresence, motion, type MotionValue } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RemoteTrackFace } from './remoteTrackTransition';
import { Button } from '../ui';

// src/components/remote/RemoteCoverTile.tsx
// 卡片左边的 112px 封面。换歌时走两张面的交错：手动切歌是方向性淡入，音频过渡（AutoMix/
// Crossfade）由本地 MotionValue 连续互换两张封面 —— 后者的两个不透明度挂在内层，
// 外层只管进出场，两层相乘，MotionValue 就不会和 initial/animate/exit 抢同一个 opacity。
//
// 闲置且「展开封面」开着时，卡片底下会铺开同一张封面的大图（RemoteCardSurface），
// 这一块整块淡出让位。

const HANDOFF_FACE_TRANSITION = { duration: 0.55, ease: 'linear' } as const;
const SWITCH_FACE_TRANSITION = { duration: 0.42, ease: [0.22, 1, 0.36, 1] } as const;

type RemoteCoverTileProps = {
    isDaylight: boolean;
    coverUrl: string | null;
    coverFaces: RemoteTrackFace[];
    hasIncomingCoverFace: boolean;
    isHandoffActive: boolean;
    handoffIncomingOpacity: MotionValue<number>;
    handoffOutgoingOpacity: MotionValue<number>;
    trackEnterOffset: number;
    /** 停在导出 / 透明控制这类面板上时，整块变成返回播放页的按钮。 */
    showBack: boolean;
    onBack: () => void;
    /** 导出倒计时；null 表示当前不在倒计时。 */
    countdown: number | null;
    /** 让位给铺满整卡的那张大封面。 */
    isSleeve: boolean;
};

const RemoteCoverTile: React.FC<RemoteCoverTileProps> = ({
    isDaylight,
    coverUrl,
    coverFaces,
    hasIncomingCoverFace,
    isHandoffActive,
    handoffIncomingOpacity,
    handoffOutgoingOpacity,
    trackEnterOffset,
    showBack,
    onBack,
    countdown,
    isSleeve,
}) => {
    const { t } = useTranslation();

    return (
        <div
            className={`relative h-[112px] w-[112px] shrink-0 overflow-hidden rounded-xl bg-cover bg-center shadow-md group transition-all duration-300 ${isDaylight ? 'bg-zinc-200 border border-black/5' : 'bg-zinc-800 border border-white/5'
                }`}
            style={{
                opacity: isSleeve ? 0 : 1,
                // 那一格在 sleeve 时塌到 0px，这块 112px 的封面会溢出到格子外边；
                // 透明归透明，它还在原地接鼠标，不关掉就会挡住右边文字上的点击。
                pointerEvents: isSleeve ? 'none' : undefined,
            }}
        >
            {!coverUrl && (
                <div className={`flex h-full w-full items-center justify-center text-3xl font-bold transition-colors duration-300 ${isDaylight ? 'text-black/35' : 'text-white/35'
                    }`}>
                    F
                </div>
            )}
            <AnimatePresence initial={false}>
                {coverFaces.map(face => {
                    const handoffOpacity = face.mode === 'incoming'
                        ? handoffIncomingOpacity
                        : isHandoffActive && hasIncomingCoverFace ? handoffOutgoingOpacity : undefined;
                    return (
                        <motion.div
                            key={`cover-${face.key}`}
                            initial={face.mode === 'incoming'
                                ? { opacity: 1, scale: 1.02, y: 0 }
                                : { opacity: 0, scale: 1.06, y: trackEnterOffset }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97, y: -trackEnterOffset }}
                            transition={face.mode === 'incoming' ? HANDOFF_FACE_TRANSITION : SWITCH_FACE_TRANSITION}
                            className="absolute inset-0 h-full w-full"
                        >
                            <motion.div
                                className="absolute inset-0 h-full w-full bg-cover bg-center"
                                style={{
                                    backgroundImage: `url(${face.coverUrl})`,
                                    ...(handoffOpacity ? { opacity: handoffOpacity } : {}),
                                }}
                            />
                        </motion.div>
                    );
                })}
            </AnimatePresence>
            {showBack && (
                <Button
                    tip={t('remote.back')}
                    onClick={onBack}
                    className={`absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl backdrop-blur-sm ${isDaylight ? 'bg-stone-900/65 text-white' : 'bg-zinc-950/65 text-white'
                        }`}
                >
                    <ChevronLeft size={24} strokeWidth={2.5} />
                </Button>
            )}
            <AnimatePresence mode="popLayout">
                {countdown !== null && (
                    <motion.div
                        key={`countdown-${countdown}`}
                        initial={{ opacity: 0, scale: 0.3 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.8 }}
                        transition={{ duration: 0.35, ease: 'easeOut' }}
                        className={`absolute inset-0 flex items-center justify-center rounded-xl backdrop-blur-[2px] z-30 ${isDaylight ? 'bg-stone-950/70' : 'bg-zinc-950/80'
                            }`}
                    >
                        <span className="text-4xl font-black text-white tracking-tighter tabular-nums drop-shadow-[0_0_12px_rgba(255,255,255,0.45)]">
                            {countdown}
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default RemoteCoverTile;
