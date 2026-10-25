import React from 'react';
import { useMotionValue, type MotionValue } from 'framer-motion';
import type { AudioBands } from '../types';
import type { WallpaperAudioPayload } from './wallpaperSurfaceTypes';

// src/entries/useWallpaperBridgedAudio.ts
// The audio bands the native side pushes, with a watchdog that zeroes them once the stream stops.

/**
 * 断流判定时长。
 *
 * 原生是**推**模型的：采集停了、蓝牙切回扬声器期间、或者那一帧被 WebView 吞了，
 * 页面这边都不会收到任何「没了」的通知。不自己看一眼，band 就永远冻在断流前那一帧上。
 * 采集节拍是 20Hz（50ms），给到 1.2s 是二十来帧的余量。
 */
const AUDIO_STALE_MS = 1200;

export const useBridgedAudio = (): { audioPower: MotionValue<number>; audioBands: AudioBands } => {
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);

    const audioBands = React.useMemo(
        () => ({ bass, lowMid, mid, vocal, treble }),
        [bass, lowMid, mid, vocal, treble]);

    React.useEffect(() => {
        let lastFrameAtMs = 0;

        const apply = (payload: WallpaperAudioPayload | null) => {
            if (!payload) {
                audioPower.set(0);
                bass.set(0);
                lowMid.set(0);
                mid.set(0);
                vocal.set(0);
                treble.set(0);
                return;
            }
            lastFrameAtMs = performance.now();
            audioPower.set(payload.power);
            bass.set(payload.bass);
            lowMid.set(payload.lowMid);
            mid.set(payload.mid);
            vocal.set(payload.vocal);
            treble.set(payload.treble);
        };

        window.__foliaWallpaperPushAudio = apply;
        const watchdog = window.setInterval(() => {
            if (lastFrameAtMs === 0) {
                return;
            }
            if (performance.now() - lastFrameAtMs < AUDIO_STALE_MS) {
                return;
            }
            // 归零之后就别再重复写了（没数据可写），但要留着看门狗等它回来。
            lastFrameAtMs = 0;
            apply(null);
        }, 500);

        return () => {
            window.__foliaWallpaperPushAudio = undefined;
            window.clearInterval(watchdog);
            apply(null);
        };
    }, [audioPower, bass, lowMid, mid, vocal, treble]);

    return React.useMemo(
        () => ({ audioPower, audioBands }),
        [audioPower, audioBands]);
};

