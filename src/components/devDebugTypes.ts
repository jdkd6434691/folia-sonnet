import type { MotionValue } from 'framer-motion';
import type { ThemeMode, DualTheme, LyricData, LyricAlternateText, LyricBackgroundVocal, LyricSyllable } from '../types';

// src/components/devDebugTypes.ts
// What the dev debug overlay reads: the snapshot it is handed, and the payload shapes inside it.

export interface DevDebugLineSnapshot {
    text: string | null;
    translation: string | null;
    wordCount: number | null;
    startTime: number | null;
    endTime: number | null;
    renderEndTime: number | null;
    rawDuration: number | null;
    timingClass: string | null;
    lineTransitionMode: string | null;
    wordRevealMode: string | null;
}

interface DevDebugRawWordSnapshot {
    text: string;
    startTime: number;
    endTime: number;
    syllables?: LyricSyllable[];
}

interface DevDebugRawLineSnapshot {
    id: string | null;
    startTime: number;
    endTime: number;
    fullText: string;
    translation: string | null;
    romanization: string | null;
    alternateTexts: LyricAlternateText[] | null;
    agentId: string | null;
    songPart: string | null;
    blockIndex: number | null;
    backgroundVocal: LyricBackgroundVocal | null;
    isChorus: boolean;
    chorusEffect: string | null;
    renderHints: Record<string, unknown> | null;
    words: DevDebugRawWordSnapshot[];
}

export interface DevDebugSnapshot {
    shortcutLabel: string;
    songKey?: string | null;
    currentView: string;
    playerState: string;
    visualizerMode: string;
    songName: string | null;
    songSource: string;
    lyricsSource: string;
    audioSrcKind: string;
    coverUrlKind?: string;
    duration: number;
    currentLineIndex: number;
    totalLines: number;
    totalWords?: number;
    maxWordsPerLine?: number;
    lyricTtml: LyricData['ttml'] | null;
    nowPlaying?: {
        connectionStatus: string;
        isActive: boolean;
        paused: boolean;
        progressMs: number;
        progressQuality: 'precise' | 'coarse';
        trackTitle: string | null;
        durationSec: number;
        lastQuerySource: 'idle' | 'progress' | 'pause-boundary' | 'resume-boundary' | 'poll';
        lastQueryStatus: 'idle' | 'pending' | 'applied' | 'skipped' | 'failed';
        lastResponseProgressMs: number | null;
        lastResponseRttMs: number | null;
        lastCandidateTimeSec: number | null;
        lastDisplayTimeSec: number | null;
        lastDriftSec: number | null;
        lastError: string | null;
    } | null;
    activeLine: DevDebugLineSnapshot | null;
    nextLine: DevDebugLineSnapshot | null;
    rawActiveLine: DevDebugRawLineSnapshot | null;
    rawNextLine: DevDebugRawLineSnapshot | null;
    themeMode: ThemeMode;
    activeDualTheme: DualTheme;
}

export interface DevDebugOverlayProps {
    snapshot: DevDebugSnapshot;
    currentTime: MotionValue<number>;
    lyricCurrentTime: MotionValue<number>;
    isDaylight: boolean;
    /** The window has a close button now, so the chord is no longer the only way out of it. */
    onClose: () => void;
}

export interface BrowserHeapMemory {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}

export interface PerformanceWithMemory extends Performance {
    memory?: BrowserHeapMemory;
}

export interface MemorySample {
    timestamp: number;
    usedHeap: number;
    totalHeap: number;
    heapLimit: number;
    domNodes: number;
}

