import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMotionValueEvent } from 'framer-motion';
import ConsoleLogPanel from './shared/ConsoleLogPanel';
// import CoverSizeAuditPanel from './shared/CoverSizeAuditPanel';
import DraggableDebugWindow from './shared/DraggableDebugWindow';
import { isConsoleCaptureEnabled, subscribeToConsoleLog } from '../utils/consoleLogBuffer';
import { DebugLineBlock, DebugMetricTable, DebugRow, RawLinePayloadBlock, TabButton, clamp, formatBytes, formatClock, formatDelta, formatSeconds } from './devDebugPanels';
import SonnetDebugPanel from './SonnetDebugPanel';
import PerfDebugPanel from './PerfDebugPanel';
import type { DevDebugOverlayProps, MemorySample, PerformanceWithMemory } from './devDebugTypes';

// src/components/DevDebugOverlay.tsx
// The dev debug overlay: console, memory, playback, lyrics, theme, Sonnet and perf tabs behind the
// developer switch. The parts it is drawn from live beside it, so this file keeps the tabs.

export type { DevDebugLineSnapshot, DevDebugSnapshot } from './devDebugTypes';

const MEMORY_SAMPLE_INTERVAL_MS = 1000;
const MEMORY_SAMPLE_LIMIT = 90;
const GC_DROP_THRESHOLD_BYTES = 8 * 1024 * 1024;

const DevDebugOverlay: React.FC<DevDebugOverlayProps> = ({
    snapshot,
    currentTime,
    lyricCurrentTime,
    isDaylight,
    onClose,
}) => {
    // Console first: on the desktop build this overlay is the only console there is, so reading it
    // is what the shortcut is pressed for.
    const [activeTab, setActiveTab] = useState<'console' | 'memory' /* | 'covers' */ | 'playback' | 'lyrics' | 'theme' | 'sonnet' | 'perf'>('console');
    // The switch in Settings > Developer governs this whole overlay, not just its Console tab. It
    // is the debug back room's switch: off means the chord opens nothing at all. Hiding one tab and
    // leaving the other five was reading the switch as "the log" when it is named for the room.
    const capturing = useSyncExternalStore(subscribeToConsoleLog, isConsoleCaptureEnabled);
    const [liveCurrentTime, setLiveCurrentTime] = useState(() => currentTime.get());
    const [liveLyricCurrentTime, setLiveLyricCurrentTime] = useState(() => lyricCurrentTime?.get() ?? currentTime.get());
    const [memoryHistory, setMemoryHistory] = useState<MemorySample[]>([]);
    const [gcCount, setGcCount] = useState(0);
    const [baselineUsedHeap, setBaselineUsedHeap] = useState<number | null>(null);
    const [baselineDomNodes, setBaselineDomNodes] = useState<number | null>(null);
    const previousUsedHeapRef = useRef<number | null>(null);

    useMotionValueEvent(currentTime, 'change', latest => {
        setLiveCurrentTime(latest);
    });

    useMotionValueEvent(lyricCurrentTime, 'change', latest => {
        setLiveLyricCurrentTime(latest);
    });

    useEffect(() => {
        setMemoryHistory([]);
        setGcCount(0);
        setBaselineUsedHeap(null);
        setBaselineDomNodes(null);
        previousUsedHeapRef.current = null;
    }, [snapshot.songKey]);

    useEffect(() => {
        const perf = performance as PerformanceWithMemory;
        if (!perf.memory) {
            return;
        }

        const sample = () => {
            const memory = perf.memory;
            if (!memory) {
                return;
            }

            const domNodes = document.getElementsByTagName('*').length;
            const usedHeap = memory.usedJSHeapSize;

            setMemoryHistory(prev => {
                const next = [
                    ...prev,
                    {
                        timestamp: Date.now(),
                        usedHeap,
                        totalHeap: memory.totalJSHeapSize,
                        heapLimit: memory.jsHeapSizeLimit,
                        domNodes,
                    },
                ];

                if (next.length > MEMORY_SAMPLE_LIMIT) {
                    next.splice(0, next.length - MEMORY_SAMPLE_LIMIT);
                }

                return next;
            });

            setBaselineUsedHeap(prev => prev ?? usedHeap);
            setBaselineDomNodes(prev => prev ?? domNodes);

            if (
                previousUsedHeapRef.current !== null
                && previousUsedHeapRef.current - usedHeap >= GC_DROP_THRESHOLD_BYTES
            ) {
                setGcCount(prev => prev + 1);
            }

            previousUsedHeapRef.current = usedHeap;
        };

        sample();
        const timer = window.setInterval(sample, MEMORY_SAMPLE_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, []);

    const latestMemorySample = memoryHistory.length > 0 ? memoryHistory[memoryHistory.length - 1] : null;
    const memorySupported = Boolean((performance as PerformanceWithMemory).memory);

    const peakUsedHeap = useMemo(() => {
        if (!memoryHistory.length) {
            return null;
        }

        return memoryHistory.reduce((peak, sample) => Math.max(peak, sample.usedHeap), 0);
    }, [memoryHistory]);

    const recentDelta = useMemo(() => {
        if (memoryHistory.length < 2) {
            return null;
        }

        const referenceIndex = Math.max(0, memoryHistory.length - 16);
        return latestMemorySample
            ? latestMemorySample.usedHeap - memoryHistory[referenceIndex].usedHeap
            : null;
    }, [latestMemorySample, memoryHistory]);

    const domDelta = latestMemorySample && baselineDomNodes !== null
        ? latestMemorySample.domNodes - baselineDomNodes
        : null;
    const heapDelta = latestMemorySample && baselineUsedHeap !== null
        ? latestMemorySample.usedHeap - baselineUsedHeap
        : null;

    const chartRange = useMemo(() => {
        if (!memoryHistory.length) {
            return { min: 0, max: 1 };
        }

        const values = memoryHistory.map(sample => sample.usedHeap);
        const min = Math.min(...values);
        const max = Math.max(...values);
        return {
            min,
            max: Math.max(max, min + 1),
        };
    }, [memoryHistory]);

    const panelClass = isDaylight
        ? 'rounded-xl border border-black/10 bg-black/[0.04]'
        : 'rounded-xl border border-white/10 bg-black/15';
    const chartBarClass = isDaylight ? 'bg-emerald-600/75' : 'bg-emerald-400/80';

    // Placed after the hooks rather than at the top, because the rule is unconditional hooks, not
    // unconditional work. The chord still flips its boolean; there is simply nothing behind it.
    if (!capturing) return null;

    return (
        // The shell - drag handle, close button, remembered position, stacking - is shared with the
        // memory monitor. It used to be pinned to the top-right corner, which is where whatever you
        // are debugging usually is.
        <DraggableDebugWindow
            id="console"
            title="Dev Debug Overlay"
            shortcutLabel={snapshot.shortcutLabel}
            isDaylight={isDaylight}
            onClose={onClose}
        >
            <div>
                <div className="text-sm font-semibold break-words">{snapshot.songName || 'No Track'}</div>

                <div className="mt-3 flex flex-wrap gap-2">
                    <TabButton label="Console" isActive={activeTab === 'console'} onClick={() => setActiveTab('console')} isDaylight={isDaylight} />
                    <TabButton label="Memory" isActive={activeTab === 'memory'} onClick={() => setActiveTab('memory')} isDaylight={isDaylight} />
                    {/* <TabButton label="Covers" isActive={activeTab === 'covers'} onClick={() => setActiveTab('covers')} isDaylight={isDaylight} /> */}
                    <TabButton label="Playback" isActive={activeTab === 'playback'} onClick={() => setActiveTab('playback')} isDaylight={isDaylight} />
                    <TabButton label="Lyrics" isActive={activeTab === 'lyrics'} onClick={() => setActiveTab('lyrics')} isDaylight={isDaylight} />
                    <TabButton label="Theme" isActive={activeTab === 'theme'} onClick={() => setActiveTab('theme')} isDaylight={isDaylight} />
                    <TabButton label="Sonnet" isActive={activeTab === 'sonnet'} onClick={() => setActiveTab('sonnet')} isDaylight={isDaylight} />
                    <TabButton label="Perf" isActive={activeTab === 'perf'} onClick={() => setActiveTab('perf')} isDaylight={isDaylight} />
                </div>

                {activeTab === 'console' && (
                    <div className="mt-3 grid gap-3">
                        <ConsoleLogPanel isDaylight={isDaylight} className={panelClass} />
                    </div>
                )}

                {activeTab === 'memory' && (
                    <div className="mt-3 grid gap-3">
                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Heap Monitor</div>
                            {memorySupported && latestMemorySample ? (
                                <div className="px-3 pb-3">
                                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                        <DebugRow label="usedHeap" value={formatBytes(latestMemorySample.usedHeap)} />
                                        <DebugRow label="totalHeap" value={formatBytes(latestMemorySample.totalHeap)} />
                                        <DebugRow label="heapLimit" value={formatBytes(latestMemorySample.heapLimit)} />
                                        <DebugRow label="sinceSong" value={formatDelta(heapDelta)} />
                                        <DebugRow label="last15s" value={formatDelta(recentDelta)} />
                                        <DebugRow label="peak" value={formatBytes(peakUsedHeap)} />
                                        <DebugRow label="domNodes" value={String(latestMemorySample.domNodes)} />
                                        <DebugRow label="domDelta" value={domDelta === null ? 'N/A' : `${domDelta >= 0 ? '+' : ''}${domDelta}` } />
                                        <DebugRow label="gcCount" value={String(gcCount)} />
                                        <DebugRow label="api" value="performance.memory" />
                                    </dl>

                                    <div className="mt-3">
                                        <div className="flex h-20 items-end gap-[2px]">
                                            {memoryHistory.map(sample => {
                                                const heightRatio = (sample.usedHeap - chartRange.min) / (chartRange.max - chartRange.min);
                                                return (
                                                    <div
                                                        key={sample.timestamp}
                                                        className={`min-w-0 flex-1 rounded-t-[2px] ${chartBarClass}`}
                                                        style={{ height: `${clamp(heightRatio, 0.08, 1) * 100}%` }}
                                                        title={`${new Date(sample.timestamp).toLocaleTimeString()} ${formatBytes(sample.usedHeap)}`}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <div className="mt-2 flex items-center justify-between text-[10px] opacity-60">
                                            <span>{formatBytes(chartRange.min)}</span>
                                            <span>{memoryHistory.length}s window</span>
                                            <span>{formatBytes(chartRange.max)}</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="px-3 pb-3 pt-2 text-[11px] opacity-70">
                                    `performance.memory` is not available in this runtime, so JS heap stats cannot be read here.
                                </div>
                            )}
                        </section>

                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Correlation</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="renderer" value={snapshot.visualizerMode} />
                                    <DebugRow label="coverUrl" value={snapshot.coverUrlKind ?? 'N/A'} />
                                    <DebugRow label="lineIndex" value={String(snapshot.currentLineIndex)} />
                                    <DebugRow label="lineCount" value={String(snapshot.totalLines)} />
                                    <DebugRow label="totalWords" value={String(snapshot.totalWords ?? 0)} />
                                    <DebugRow label="maxLineWords" value={String(snapshot.maxWordsPerLine ?? 0)} />
                                    <DebugRow
                                        label="activeWords"
                                        value={snapshot.activeLine?.wordCount === null || snapshot.activeLine?.wordCount === undefined ? 'N/A' : String(snapshot.activeLine.wordCount)}
                                    />
                                </dl>
                            </div>
                        </section>

                    </div>
                )}

                {/* Cover size audit, switched off - see the note in src/index.tsx.
                {activeTab === 'covers' && (
                    <div className="mt-3 grid gap-3">
                        <CoverSizeAuditPanel isDaylight={isDaylight} panelClass={panelClass} />
                    </div>
                )} */}

                {activeTab === 'playback' && (
                    <div className="mt-3 grid gap-3">
                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Playback</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="view" value={snapshot.currentView} />
                                    <DebugRow label="player" value={snapshot.playerState} />
                                    <DebugRow label="renderer" value={snapshot.visualizerMode} />
                                    <DebugRow
                                        label="time"
                                        value={`${formatClock(liveCurrentTime)} / ${formatClock(snapshot.duration)} (${formatSeconds(liveCurrentTime)})`}
                                    />
                                    <DebugRow
                                        label="lyricTime"
                                        value={`${formatClock(liveLyricCurrentTime)} (${formatSeconds(liveLyricCurrentTime)})`}
                                    />
                                    <DebugRow label="songSource" value={snapshot.songSource} />
                                    <DebugRow label="lyricsSource" value={snapshot.lyricsSource} />
                                    <DebugRow label="audioSrc" value={snapshot.audioSrcKind} />
                                    <DebugRow label="coverUrl" value={snapshot.coverUrlKind ?? 'N/A'} />
                                </dl>
                            </div>
                        </section>

                        {snapshot.nowPlaying ? (
                            <section className={panelClass}>
                                <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Now Playing Clock</div>
                                <div className="px-3 pb-3">
                                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                        <DebugRow label="connection" value={snapshot.nowPlaying.connectionStatus} />
                                        <DebugRow label="active" value={snapshot.nowPlaying.isActive ? 'yes' : 'no'} />
                                        <DebugRow label="paused" value={snapshot.nowPlaying.paused ? 'yes' : 'no'} />
                                        <DebugRow label="wsProgress" value={`${snapshot.nowPlaying.progressMs}ms (${snapshot.nowPlaying.progressQuality})`} />
                                        <DebugRow label="lastQuery" value={`${snapshot.nowPlaying.lastQuerySource} / ${snapshot.nowPlaying.lastQueryStatus}`} />
                                        <DebugRow label="queryProgress" value={snapshot.nowPlaying.lastResponseProgressMs === null ? 'N/A' : `${snapshot.nowPlaying.lastResponseProgressMs}ms`} />
                                        <DebugRow label="rtt" value={snapshot.nowPlaying.lastResponseRttMs === null ? 'N/A' : `${snapshot.nowPlaying.lastResponseRttMs.toFixed(1)}ms`} />
                                        <DebugRow label="display" value={formatSeconds(snapshot.nowPlaying.lastDisplayTimeSec)} />
                                        <DebugRow label="candidate" value={formatSeconds(snapshot.nowPlaying.lastCandidateTimeSec)} />
                                        <DebugRow label="drift" value={formatSeconds(snapshot.nowPlaying.lastDriftSec)} />
                                        <DebugRow label="error" value={snapshot.nowPlaying.lastError ?? 'N/A'} />
                                    </dl>
                                </div>
                            </section>
                        ) : null}

                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Lyrics Scale</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="lineIndex" value={String(snapshot.currentLineIndex)} />
                                    <DebugRow label="lineCount" value={String(snapshot.totalLines)} />
                                    <DebugRow label="totalWords" value={String(snapshot.totalWords ?? 0)} />
                                    <DebugRow label="maxLineWords" value={String(snapshot.maxWordsPerLine ?? 0)} />
                                    <DebugRow
                                        label="activeWords"
                                        value={snapshot.activeLine?.wordCount === null || snapshot.activeLine?.wordCount === undefined ? 'N/A' : String(snapshot.activeLine.wordCount)}
                                    />
                                </dl>
                            </div>
                        </section>
                    </div>
                )}

                {activeTab === 'lyrics' && (
                    <div className="mt-3 grid gap-2">
                        <DebugLineBlock
                            label="Current Line"
                            line={snapshot.activeLine}
                            isDaylight={isDaylight}
                            currentTime={liveLyricCurrentTime}
                            nextLineStartTime={snapshot.nextLine?.startTime ?? null}
                        />
                        <DebugLineBlock
                            label="Next Line"
                            line={snapshot.nextLine}
                            isDaylight={isDaylight}
                            currentTime={liveLyricCurrentTime}
                            nextLineStartTime={null}
                        />
                        <RawLinePayloadBlock
                            label="TTML Payload"
                            payload={snapshot.lyricTtml}
                            isDaylight={isDaylight}
                        />
                        <RawLinePayloadBlock
                            label="Raw Current Line Payload"
                            payload={snapshot.rawActiveLine}
                            isDaylight={isDaylight}
                        />
                        <RawLinePayloadBlock
                            label="Raw Next Line Payload"
                            payload={snapshot.rawNextLine}
                            isDaylight={isDaylight}
                        />
                    </div>
                )}

                {activeTab === 'theme' && (
                    <div className="mt-3 grid gap-3">
                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Theme Status</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="Mode" value={snapshot.themeMode} />
                                    <DebugRow label="Daylight Mode" value={isDaylight ? 'Light' : 'Dark'} />
                                    <DebugRow label="Active Name" value={isDaylight ? snapshot.activeDualTheme.light.name : snapshot.activeDualTheme.dark.name} />
                                </dl>
                            </div>
                        </section>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <DebugMetricTable
                                title="Light Theme"
                                isDaylight={isDaylight}
                                rows={[
                                    { label: 'Name', value: snapshot.activeDualTheme.light.name },
                                    { label: 'BG', value: snapshot.activeDualTheme.light.backgroundColor },
                                    { label: 'Primary', value: snapshot.activeDualTheme.light.primaryColor },
                                    { label: 'Accent', value: snapshot.activeDualTheme.light.accentColor },
                                    { label: 'Secondary', value: snapshot.activeDualTheme.light.secondaryColor },
                                    { label: 'Font Style', value: snapshot.activeDualTheme.light.fontStyle },
                                    { label: 'Font Family', value: snapshot.activeDualTheme.light.fontFamily ?? 'N/A' },
                                    { label: 'Animation', value: snapshot.activeDualTheme.light.animationIntensity },
                                    { label: 'Word Colors', value: snapshot.activeDualTheme.light.wordColors?.map(wc => `${wc.word}: ${wc.color}`).join(', ') || '[]' },
                                    { label: 'Icons', value: snapshot.activeDualTheme.light.lyricsIcons?.join(', ') || '[]' },
                                    { label: 'Provider', value: snapshot.activeDualTheme.light.provider ?? 'N/A' },
                                    { label: 'Desc', value: snapshot.activeDualTheme.light.description ?? 'N/A' },
                                ]}
                            />
                            <DebugMetricTable
                                title="Dark Theme"
                                isDaylight={isDaylight}
                                rows={[
                                    { label: 'Name', value: snapshot.activeDualTheme.dark.name },
                                    { label: 'BG', value: snapshot.activeDualTheme.dark.backgroundColor },
                                    { label: 'Primary', value: snapshot.activeDualTheme.dark.primaryColor },
                                    { label: 'Accent', value: snapshot.activeDualTheme.dark.accentColor },
                                    { label: 'Secondary', value: snapshot.activeDualTheme.dark.secondaryColor },
                                    { label: 'Font Style', value: snapshot.activeDualTheme.dark.fontStyle },
                                    { label: 'Font Family', value: snapshot.activeDualTheme.dark.fontFamily ?? 'N/A' },
                                    { label: 'Animation', value: snapshot.activeDualTheme.dark.animationIntensity },
                                    { label: 'Word Colors', value: snapshot.activeDualTheme.dark.wordColors?.map(wc => `${wc.word}: ${wc.color}`).join(', ') || '[]' },
                                    { label: 'Icons', value: snapshot.activeDualTheme.dark.lyricsIcons?.join(', ') || '[]' },
                                    { label: 'Provider', value: snapshot.activeDualTheme.dark.provider ?? 'N/A' },
                                    { label: 'Desc', value: snapshot.activeDualTheme.dark.description ?? 'N/A' },
                                ]}
                            />
                        </div>
                    </div>
                )}
                {activeTab === 'sonnet' && (
                    <div className="mt-3 grid gap-3">
                        <SonnetDebugPanel isDaylight={isDaylight} panelClass={panelClass} />
                    </div>
                )}
                {activeTab === 'perf' && (
                    <div className="mt-3 grid gap-3">
                        <PerfDebugPanel isDaylight={isDaylight} panelClass={panelClass} />
                    </div>
                )}
            </div>
        </DraggableDebugWindow>
    );
};
export default DevDebugOverlay;
