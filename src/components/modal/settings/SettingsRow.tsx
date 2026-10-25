import React from 'react';
import { Row, type SettingsOptionDef } from './kit';
import { Button } from '@/components/ui';

// src/components/modal/settings/SettingsRow.tsx
// One row of the wallpaper section. It used to draw its own two lines — the title, then the
// description under it — inside a card the section drew for itself; the pages have moved to the
// kit, and so has it: the kit's Row draws the label and the control, and the description is kept
// behind the row's "i" rather than printed under the label, which is where the other rows of the
// settings keep theirs. `dividerClass` and `isLast` belonged to that card of its own; they are left
// so the section's older callers pass them without a change.

type SettingsRowProps = {
    /** The row's option: it gives the label, the note behind the "i", and the id a landing looks for. */
    option?: SettingsOptionDef;
    /** Title of a row that is none of the page's options. */
    title?: React.ReactNode;
    /** The explanation, kept behind the "i". */
    description?: React.ReactNode;
    /** A second line in the same place, for a caveat. */
    note?: React.ReactNode;
    /** Usually a toggle; anything that sits at the row's right edge. */
    control?: React.ReactNode;
    /** Content under the title block spanning the row's full width, e.g. a slider. */
    children?: React.ReactNode;
    sub?: boolean;
    disabled?: boolean;
    dividerClass?: string;
    isLast?: boolean;
};

export const SettingsRow: React.FC<SettingsRowProps> = ({
    option,
    title,
    description,
    note,
    control,
    children,
    sub,
    disabled,
}) => (
    <Row
        option={option}
        label={title}
        note={description || note ? <>{description}{note}</> : undefined}
        below={children}
        sub={sub}
        disabled={disabled}
    >
        {control}
    </Row>
);

type SettingsToggleProps = {
    checked: boolean;
    onChange: () => void;
    offClass: string;
    /** Track color when on; the theme's secondary color in every settings page. */
    onColor?: string;
    disabled?: boolean;
    ariaLabel?: string;
};

export const SettingsToggle: React.FC<SettingsToggleProps> = ({ checked, onChange, offClass, onColor, disabled, ariaLabel }) => (
    <Button
        onClick={onChange}
        disabled={disabled}
        aria-pressed={checked}
        aria-label={ariaLabel}
        className={`shrink-0 w-12 h-6 rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? '' : offClass}`}
        style={{ backgroundColor: checked ? onColor || 'rgba(114, 119, 134, 1)' : undefined }}
    >
        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
    </Button>
);

export default SettingsRow;
