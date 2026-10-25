import React from 'react';
import { DEFAULT_CLADDAGH_TUNING, type CladdaghTuning } from '../../../types';
import { Group, Row, Toggle, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import { SliderRow, times } from '../panelRows';

// src/components/visualizer/claddagh/CladdaghSettingsPanel.tsx
// Claddagh's settings: focus scale, ring radius, ellipse tilt, axis line and letter spacing.
const CLADDAGH_GROUP: SettingsGroupDef = { id: 'vis-claddagh', titleKey: 'options.claddaghSettings' };

const clampCladdaghFocusScaleRatio = (val: number) => Math.min(1.5, Math.max(0.0, val));
const clampCladdaghRadiusScale = (val: number) => Math.min(1.5, Math.max(0.5, val));
const clampCladdaghEllipseTiltDeg = (val: number) => Math.min(60, Math.max(0, val));
const clampCladdaghLetterSpacingOffset = (val: number) => Math.min(20, Math.max(-5, val));

export const CladdaghSettingsPanel: React.FC<VisualizerSettingsPanelProps<CladdaghTuning>> = ({
    t,
    onSliderPointerDown,
    onSliderCommit,
    tuning: claddaghTuning = DEFAULT_CLADDAGH_TUNING,
    onTuningChange: onCladdaghTuningChange,
}) => {
    const resolvedTuning: CladdaghTuning = {
        focusScaleRatio: clampCladdaghFocusScaleRatio(claddaghTuning.focusScaleRatio ?? DEFAULT_CLADDAGH_TUNING.focusScaleRatio),
        radiusScale: clampCladdaghRadiusScale(claddaghTuning.radiusScale ?? DEFAULT_CLADDAGH_TUNING.radiusScale),
        ellipseTiltDeg: clampCladdaghEllipseTiltDeg(claddaghTuning.ellipseTiltDeg ?? DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg),
        showAxisLine: claddaghTuning.showAxisLine ?? DEFAULT_CLADDAGH_TUNING.showAxisLine,
        letterSpacingOffset: clampCladdaghLetterSpacingOffset(claddaghTuning.letterSpacingOffset ?? DEFAULT_CLADDAGH_TUNING.letterSpacingOffset),
    };
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <Group def={CLADDAGH_GROUP}>
            <SliderRow
                {...drag}
                label={t('options.claddaghFocusScaleRatio')}
                value={resolvedTuning.focusScaleRatio}
                min={0}
                max={1.5}
                step={0.05}
                format={(value) => times(value + 1.0)}
                onChange={(value) => onCladdaghTuningChange?.({ focusScaleRatio: value })}
            />
            <SliderRow
                {...drag}
                label={t('options.claddaghRadiusScale')}
                value={resolvedTuning.radiusScale}
                min={0.5}
                max={1.5}
                step={0.05}
                format={times}
                onChange={(value) => onCladdaghTuningChange?.({ radiusScale: value })}
            />
            <SliderRow
                {...drag}
                label={t('options.claddaghEllipseTiltDeg')}
                value={resolvedTuning.ellipseTiltDeg}
                min={0}
                max={60}
                step={1}
                format={(value) => `${value}°`}
                onChange={(value) => onCladdaghTuningChange?.({ ellipseTiltDeg: value })}
            />
            <Row label={t('options.claddaghShowAxisLine')}>
                <Toggle
                    checked={resolvedTuning.showAxisLine}
                    onChange={(next) => onCladdaghTuningChange?.({ showAxisLine: next })}
                />
            </Row>
            <SliderRow
                {...drag}
                label={t('options.claddaghLetterSpacingOffset')}
                value={resolvedTuning.letterSpacingOffset}
                min={-5}
                max={20}
                step={0.5}
                format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}px`}
                onChange={(value) => onCladdaghTuningChange?.({ letterSpacingOffset: value })}
            />
        </Group>
    );
};
