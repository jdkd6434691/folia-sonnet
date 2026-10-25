import React from 'react';
import { Button } from './ui';
import type { DevDebugLineSnapshot } from './devDebugTypes';

// src/components/devDebugPanels.tsx
// The parts the dev debug overlay's tabs are drawn from: formatters, metric tables, lyric status
// pills and the line blocks. Pure rendering - no diagnostics are read here.

export const formatSeconds = (value: number | null | undefined) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 'N/A';
    }

    return `${value.toFixed(3)}s`;
};

/**
 * 音频延迟用毫秒读 —— baseLatency 常常只有几毫秒（一个渲染量子），写成 `0.003s` 里那两个
 * 零只会挡住真正要看的那一位。
 */
export const formatMs = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    return `${(value * 1000).toFixed(1)}ms`;
};

export const formatClock = (value: number) => {
    if (!Number.isFinite(value) || value < 0) {
        return '00:00';
    }

    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const formatBytes = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return 'N/A';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let nextValue = value;
    let unitIndex = 0;

    while (nextValue >= 1024 && unitIndex < units.length - 1) {
        nextValue /= 1024;
        unitIndex += 1;
    }

    const precision = unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2;
    return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
};

export const formatDelta = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'N/A';
    }

    if (value === 0) {
        return '0 B';
    }

    const sign = value > 0 ? '+' : '-';
    return `${sign}${formatBytes(Math.abs(value))}`;
};

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const DebugRow: React.FC<{ label: string; value: string; }> = ({ label, value }) => {
    return (
        <>
            <dt className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</dt>
            <dd className="text-[11px] font-medium text-right break-words">{value}</dd>
        </>
    );
};

const renderCellValue = (value: string, isDaylight: boolean) => {
    if (/^#[0-9a-fA-F]{3,8}$/.test(value.trim())) {
        return (
            <span className="inline-flex items-center gap-1.5">
                <span
                    className={`inline-block h-2.5 w-2.5 rounded-full border shrink-0 ${isDaylight ? 'border-black/15' : 'border-white/15'}`}
                    style={{ backgroundColor: value.trim() }}
                />
                <span>{value}</span>
            </span>
        );
    }
    return value;
};

export const DebugMetricTable: React.FC<{
    title?: string;
    rows: Array<{ label: string; value: string; }>;
    isDaylight: boolean;
}> = ({ title, rows, isDaylight }) => {
    const cellClass = isDaylight
        ? 'border-black/10 bg-white/40'
        : 'border-white/10 bg-white/[0.03]';

    return (
        <div className={`overflow-hidden rounded-lg border text-[10px] ${isDaylight ? 'border-black/10' : 'border-white/10'}`}>
            {title ? (
                <div className={`border-b px-2 py-1 text-[9px] uppercase tracking-[0.14em] opacity-60 ${isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-white/[0.02]'}`}>
                    {title}
                </div>
            ) : null}
            <table className="w-full border-collapse">
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={row.label}>
                            <th
                                className={`w-[4.75rem] border-b px-2 py-1 text-left font-medium uppercase tracking-[0.12em] opacity-65 ${cellClass} ${index === rows.length - 1 ? 'border-b-0' : ''}`}
                            >
                                {row.label}
                            </th>
                            <td
                                className={`border-b px-2 py-1 font-medium break-all ${cellClass} ${index === rows.length - 1 ? 'border-b-0' : ''}`}
                            >
                                {renderCellValue(row.value, isDaylight)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export interface LyricStatusPill {
    key: string;
    label: string;
    value?: string;
    tone: 'slate' | 'blue' | 'amber' | 'emerald' | 'rose';
}

const buildLyricStatusPills = (
    line: DevDebugLineSnapshot | null,
    currentTime: number,
    nextLineStartTime: number | null | undefined,
): LyricStatusPill[] => {
    if (!line) {
        return [];
    }

    const startTime = line.startTime;
    const endTime = line.endTime;
    const renderEndTime = line.renderEndTime;
    const hasCompleteTiming = [startTime, endTime, renderEndTime].every(value => typeof value === 'number' && Number.isFinite(value));

    if (!hasCompleteTiming) {
        return [
            { key: 'timing', label: 'Timing', value: 'N/A', tone: 'slate' },
        ];
    }

    const start = startTime as number;
    const end = endTime as number;
    const renderEnd = renderEndTime as number;
    const revealLag = renderEnd - end;

    const phase: LyricStatusPill = currentTime < start
        ? { key: 'phase', label: 'Phase', value: 'Before Start', tone: 'slate' }
        : currentTime < end
            ? { key: 'phase', label: 'Phase', value: 'Reveal Active', tone: 'blue' }
            : currentTime < renderEnd
                ? { key: 'phase', label: 'Phase', value: 'Past End / Hold', tone: 'amber' }
                : { key: 'phase', label: 'Phase', value: 'Past RenderEnd', tone: 'emerald' };

    const revealState: LyricStatusPill = currentTime < end
        ? { key: 'reveal', label: 'Reveal', value: 'Incomplete', tone: 'rose' }
        : { key: 'reveal', label: 'Reveal', value: 'Completed', tone: 'emerald' };

    const holdState: LyricStatusPill = renderEnd > end
        ? currentTime < end
            ? { key: 'hold', label: 'Render Hold', value: `+${(revealLag).toFixed(3)}s`, tone: 'amber' }
            : currentTime < renderEnd
                ? { key: 'hold', label: 'Render Hold', value: `${(renderEnd - currentTime).toFixed(3)}s left`, tone: 'amber' }
                : { key: 'hold', label: 'Render Hold', value: 'Consumed', tone: 'slate' }
        : { key: 'hold', label: 'Render Hold', value: 'None', tone: 'slate' };

    const cutoffState: LyricStatusPill = typeof nextLineStartTime === 'number' && Number.isFinite(nextLineStartTime)
        ? nextLineStartTime < renderEnd
            ? {
                key: 'cutoff',
                label: 'RenderEnd Cutoff',
                value: `${formatSeconds(renderEnd)} -> ${formatSeconds(nextLineStartTime)}`,
                tone: 'rose',
            }
            : {
                key: 'cutoff',
                label: 'RenderEnd Cutoff',
                value: `No (${formatSeconds(nextLineStartTime)} >= ${formatSeconds(renderEnd)})`,
                tone: 'emerald',
            }
        : {
            key: 'cutoff',
            label: 'RenderEnd Cutoff',
            value: 'N/A',
            tone: 'slate',
        };

    const currentMarker: LyricStatusPill = currentTime < end
        ? { key: 'marker', label: 'Current vs End', value: `${(end - currentTime).toFixed(3)}s left`, tone: 'blue' }
        : currentTime < renderEnd
            ? { key: 'marker', label: 'Current vs End', value: `+${(currentTime - end).toFixed(3)}s`, tone: 'amber' }
            : { key: 'marker', label: 'Current vs End', value: `+${(currentTime - end).toFixed(3)}s`, tone: 'slate' };

    return [phase, revealState, cutoffState, holdState, currentMarker];
};

export const DebugStatusPill: React.FC<{ pill: LyricStatusPill; isDaylight: boolean; }> = ({ pill, isDaylight }) => {
    const toneClassMap = isDaylight
        ? {
            slate: 'bg-zinc-900/8 text-zinc-800',
            blue: 'bg-sky-500/18 text-sky-900',
            amber: 'bg-amber-500/20 text-amber-950',
            emerald: 'bg-emerald-500/18 text-emerald-900',
            rose: 'bg-rose-500/18 text-rose-900',
        }
        : {
            slate: 'bg-white/10 text-zinc-100',
            blue: 'bg-sky-400/20 text-sky-100',
            amber: 'bg-amber-400/20 text-amber-100',
            emerald: 'bg-emerald-400/20 text-emerald-100',
            rose: 'bg-rose-400/20 text-rose-100',
        };

    return (
        <div className={`rounded-full px-2.5 py-1 text-[10px] leading-tight ${toneClassMap[pill.tone]}`}>
            <span className="uppercase tracking-[0.14em] opacity-70">{pill.label}</span>
            {pill.value ? <span className="ml-1 font-semibold">{pill.value}</span> : null}
        </div>
    );
};

export const DebugLineBlock: React.FC<{ label: string; line: DevDebugLineSnapshot | null; isDaylight: boolean; currentTime: number; nextLineStartTime?: number | null; }> = ({
    label,
    line,
    isDaylight,
    currentTime,
    nextLineStartTime,
}) => {
    const blockClass = isDaylight
        ? 'border-black/10 bg-black/[0.04]'
        : 'border-white/10 bg-black/15';
    const statusPills = buildLyricStatusPills(line, currentTime, nextLineStartTime);

    if (!line) {
        return (
            <section className={`rounded-xl border px-3 py-2 ${blockClass}`}>
                <div className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</div>
                <div className="mt-1 text-[11px] font-medium">N/A</div>
            </section>
        );
    }

    return (
        <section className={`rounded-xl border px-3 py-2 ${blockClass}`}>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</div>
            {statusPills.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                    {statusPills.map(pill => (
                        <DebugStatusPill key={pill.key} pill={pill} isDaylight={isDaylight} />
                    ))}
                </div>
            ) : null}
            <div className="mt-1 text-[11px] font-medium whitespace-pre-wrap break-words">
                {line.text || 'N/A'}
            </div>
            {line.translation ? (
                <div className="mt-1 text-[10px] opacity-70 whitespace-pre-wrap break-words">
                    {line.translation}
                </div>
            ) : null}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <DebugMetricTable
                    title="Scale"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'words', value: line.wordCount === null ? 'N/A' : String(line.wordCount) },
                        { label: 'raw', value: formatSeconds(line.rawDuration) },
                    ]}
                />
                <DebugMetricTable
                    title="Window"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'start', value: formatSeconds(line.startTime) },
                        { label: 'end', value: formatSeconds(line.endTime) },
                        { label: 'renderEnd', value: formatSeconds(line.renderEndTime) },
                    ]}
                />
                <DebugMetricTable
                    title="Profile"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'timing', value: line.timingClass ?? 'N/A' },
                        { label: 'transition', value: line.lineTransitionMode ?? 'N/A' },
                    ]}
                />
                <DebugMetricTable
                    title="Reveal"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'mode', value: line.wordRevealMode ?? 'N/A' },
                    ]}
                />
            </div>
        </section>
    );
};

export const RawLinePayloadBlock: React.FC<{
    label: string;
    payload: unknown;
    isDaylight: boolean;
}> = ({ label, payload, isDaylight }) => {
    const blockClass = isDaylight
        ? 'border-black/10 bg-black/[0.04]'
        : 'border-white/10 bg-black/15';
    const codeClass = isDaylight
        ? 'border-black/10 bg-white/45 text-zinc-900'
        : 'border-white/10 bg-black/25 text-zinc-100';

    return (
        <section className={`rounded-xl border px-3 py-2 ${blockClass}`}>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</div>
            {payload ? (
                <pre className={`mt-2 overflow-x-auto rounded-lg border px-2.5 py-2 text-[10px] leading-4 ${codeClass}`}>
                    {JSON.stringify(payload, null, 2)}
                </pre>
            ) : (
                <div className="mt-1 text-[11px] font-medium">N/A</div>
            )}
        </section>
    );
};

export const TabButton: React.FC<{
    label: string;
    isActive: boolean;
    onClick: () => void;
    isDaylight: boolean;
}> = ({ label, isActive, onClick, isDaylight }) => {
    const baseClass = isDaylight
        ? 'border-black/10 hover:bg-black/[0.05]'
        : 'border-white/10 hover:bg-white/[0.07]';
    const activeClass = isDaylight
        ? 'bg-black/[0.08] text-zinc-950'
        : 'bg-white/[0.12] text-white';

    return (
        <Button
            onClick={onClick}
            className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${baseClass} ${isActive ? activeClass : 'opacity-75'}`}
        >
            {label}
        </Button>
    );
};

