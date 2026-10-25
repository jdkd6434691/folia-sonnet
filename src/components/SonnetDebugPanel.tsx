import React from 'react';
import { sonnetDebugState, type SonnetDebugShotInfo } from './visualizer/sonnet/sonnetDebug';
import { DebugMetricTable, DebugRow, DebugStatusPill, formatSeconds, type LyricStatusPill } from './devDebugPanels';

// src/components/SonnetDebugPanel.tsx
// The Sonnet tab: the active shot, its camera and MG picks, and every segment placement.

const SONNET_ROLE_COLORS: Record<string, string> = {
    hero: '#ff4466',
    'semi-hero': '#ffaa00',
    support: '#44ccff',
    decoration: '#888888',
};

// Counts AABB overlaps between real (non-decoration) segment boxes; the quickest
// way to spot a "everything piled in one spot" layout regression.
const countSonnetSegmentOverlaps = (info: SonnetDebugShotInfo) => {
    const segments = info.segments.filter(item => item.role !== 'decoration');
    let count = 0;
    for (let a = 0; a < segments.length; a += 1) {
        for (let b = a + 1; b < segments.length; b += 1) {
            const pa = segments[a];
            const pb = segments[b];
            const dx = Math.abs(pa.x - pb.x) - (pa.width + pb.width) / 2;
            const dy = Math.abs(pa.y - pb.y) - (pa.height + pb.height) / 2;
            if (dx < 0 && dy < 0) count += 1;
        }
    }
    return count;
};

export const SonnetDebugPanel: React.FC<{ isDaylight: boolean; panelClass: string; }> = ({ isDaylight, panelClass }) => {
    const info = sonnetDebugState.activeShot;
    if (!info) {
        return (
            <section className={panelClass}>
                <div className="px-3 py-3 text-[11px] opacity-70">
                    No active Sonnet shot. Switch the renderer to Sonnet and play a track with lyrics.
                </div>
            </section>
        );
    }

    const overlaps = countSonnetSegmentOverlaps(info);
    const heroes = info.segments.filter(item => item.role === 'hero').length;
    const semiHeroes = info.segments.filter(item => item.role === 'semi-hero').length;
    const overlapPill: LyricStatusPill = overlaps > 0
        ? { key: 'overlap', label: 'Overlaps', value: String(overlaps), tone: 'rose' }
        : { key: 'overlap', label: 'Overlaps', value: 'None', tone: 'emerald' };
    const cellClass = isDaylight ? 'border-black/10' : 'border-white/10';

    return (
        <>
            <section className={panelClass}>
                <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Active Shot</div>
                <div className="px-3 pb-3">
                    <div className="mt-2 flex flex-wrap gap-2">
                        <DebugStatusPill pill={overlapPill} isDaylight={isDaylight} />
                        <DebugStatusPill
                            pill={{ key: 'kind', label: 'Layout', value: info.shotKind, tone: 'blue' }}
                            isDaylight={isDaylight}
                        />
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                        <DebugRow label="shotKind" value={info.shotKind} />
                        <DebugRow label="shotId" value={info.shotId} />
                        <DebugRow label="shot" value={`${info.shotIndex + 1} / ${info.shotCount}`} />
                        <DebugRow label="paragraph" value={`${info.paragraphKind} #${sonnetDebugState.paragraphIndex} (${info.paragraphId})`} />
                        <DebugRow label="lines" value={info.lineIndices.join(', ')} />
                        <DebugRow label="window" value={`${formatSeconds(info.startTime)} -> ${formatSeconds(info.endTime)}`} />
                    </dl>
                </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
                <DebugMetricTable
                    title="Camera"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'zoom', value: info.camera.zoom.toFixed(3) },
                        { label: 'x / y', value: `${info.camera.x.toFixed(3)} / ${info.camera.y.toFixed(3)}` },
                        { label: 'rotation', value: info.camera.rotation.toFixed(3) },
                    ]}
                />
                <DebugMetricTable
                    title="MG & Type"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'geoMG', value: info.geoVariantLabel ?? 'n/a (no geo layer)' },
                        { label: 'bgMG', value: info.backgroundMgLabel },
                        { label: 'fixedGeo', value: info.fixedGeoLabel ?? 'n/a (no fixed geo)' },
                        { label: 'decor', value: info.backgroundDecorLabel },
                        { label: 'seed', value: info.programSeed },
                        { label: 'baseFont', value: info.baseFontSize.toFixed(1) },
                        { label: 'words', value: String(info.wordCount) },
                        { label: 'segments', value: `${info.segments.length} (hero ${heroes} / semi ${semiHeroes})` },
                    ]}
                />
            </div>

            <section className={panelClass}>
                <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Segment Placements</div>
                <div className="max-h-64 overflow-y-auto px-1 pb-2 pt-1">
                    <table className="w-full border-collapse text-[10px]">
                        <thead className={`sticky top-0 ${isDaylight ? 'bg-white/90' : 'bg-zinc-900/90'}`}>
                            <tr className="opacity-60">
                                <th className="px-1 py-1 text-left font-medium">#</th>
                                <th className="px-1 py-1 text-left font-medium">text</th>
                                <th className="px-1 py-1 text-left font-medium">role</th>
                                <th className="px-1 py-1 text-right font-medium">x</th>
                                <th className="px-1 py-1 text-right font-medium">y</th>
                                <th className="px-1 py-1 text-right font-medium">w×h</th>
                                <th className="px-1 py-1 text-right font-medium">scale</th>
                            </tr>
                        </thead>
                        <tbody>
                            {info.segments.map((segment, index) => (
                                <tr key={index} className={`border-t ${cellClass}`}>
                                    <td className="px-1 py-0.5 opacity-60">{index}</td>
                                    <td className="max-w-[7rem] truncate px-1 py-0.5" title={segment.text}>
                                        {segment.text.trim() || '␣'}
                                        {segment.vertical ? ' ⇅' : ''}
                                    </td>
                                    <td
                                        className="px-1 py-0.5 font-semibold"
                                        style={{ color: SONNET_ROLE_COLORS[segment.role] ?? '#ffffff' }}
                                    >
                                        {segment.role}
                                    </td>
                                    <td className="px-1 py-0.5 text-right">{segment.x.toFixed(0)}</td>
                                    <td className="px-1 py-0.5 text-right">{segment.y.toFixed(0)}</td>
                                    <td className="px-1 py-0.5 text-right">{`${segment.width.toFixed(0)}×${segment.height.toFixed(0)}`}</td>
                                    <td className="px-1 py-0.5 text-right">{segment.fontScale.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </>
    );
};

export default SonnetDebugPanel;
