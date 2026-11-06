import React from 'react';
import { Shuffle } from 'lucide-react';
import type { VisualizerMode } from '../../../types';
import type { PictureState } from '../../modal/settings/kit';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import LyricStylePicture from '../preview/LyricStylePicture';
import { VisualizerModeGlyph } from '../modeGlyphs';

// Random is a picker choice, never a renderer id or a separate set of style parameters.
export const RANDOM_VISUALIZER_CHOICE = '__random__';

export const drawLyricStyleChoice = (mode: VisualizerMode, state: PictureState) => (
    mode === RANDOM_VISUALIZER_CHOICE
        ? <span className="grid h-full w-full place-items-center text-[color:var(--st-accent)]"><Shuffle size={28} /></span>
        : <LyricStylePicture mode={mode} {...state} />
);

export const drawLyricStyleChoiceGlyph = (mode: VisualizerMode) => (
    mode === RANDOM_VISUALIZER_CHOICE ? <Shuffle size={18} /> : <VisualizerModeGlyph mode={mode} size={18} />
);

/** A style in the random pool's pickers: its glyph, not a live picture, so opening one draws nothing heavy. */
export const drawRandomPoolChoice = (mode: VisualizerMode) => (
    <span className="grid h-full w-full place-items-center text-[color:var(--st-t2)]">
        <VisualizerModeGlyph mode={mode} size={22} />
    </span>
);

/**
 * A style in the player panel's picker: its glyph, not a live picture.
 *
 * The panel shows the whole list at once — some twenty styles — and pictures are made one after
 * another for the whole page (pictureTurns: one style at a time, one WebGL context each, and each
 * waits 0.35 s or more to stand still). Twenty of them take over ten seconds, so the columns at the
 * far end sat empty after the picker opened. The panel is for choosing; to judge a style, the way
 * on to the full window at the bottom of the picker has the large preview.
 */
export const drawLyricStyleChoiceTile = (mode: VisualizerMode) => (
    <span className="grid h-full w-full place-items-center text-[color:var(--st-t2)]">
        {mode === RANDOM_VISUALIZER_CHOICE ? <Shuffle size={22} /> : <VisualizerModeGlyph mode={mode} size={22} />}
    </span>
);

export const selectLyricStyleChoice = (mode: VisualizerMode, select: (mode: VisualizerMode) => void, notify = true) => {
    if (mode === RANDOM_VISUALIZER_CHOICE) {
        useVisualizerSettingsStore.getState().handleToggleRandomVisualizerModePerSong(true, { notify });
    } else {
        select(mode);
    }
};
