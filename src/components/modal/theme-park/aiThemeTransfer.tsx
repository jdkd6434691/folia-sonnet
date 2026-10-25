import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DualTheme } from '../../../types';
import { sanitizeDualTheme } from '../../../services/themeSanitizer';
import { THEME_GENERATION_PROMPT_PREFIX, buildThemeSourcePrompt, parseAiThemeJsonInput } from '../../../utils/aiThemePrompts';
import { FIELD_SURFACE_CLASS } from '../settings/kit';
import { TextArea } from '@/components/ui';

// src/components/modal/theme-park/aiThemeTransfer.tsx
// The manual round trip of an AI theme, as both theme editors offer it: the prompt to copy into
// any AI model, and the box its JSON answer is pasted into. What the editor does with a theme that
// was read (load it as a draft, save it) is the editor's.

/** What the prompt is written from: the playing song. */
export type AiThemePromptSource = {
    promptSourceText: string | null;
    isPureMusic: boolean;
    songTitle: string | undefined;
};

/** The whole prompt: the instructions, then the song. */
export const buildAiThemePrompt = ({ promptSourceText, isPureMusic, songTitle }: AiThemePromptSource): string => (
    `${THEME_GENERATION_PROMPT_PREFIX}\n\n${buildThemeSourcePrompt(promptSourceText || '', isPureMusic, songTitle)}`
);

/**
 * The pasted JSON and what became of it. `apply` reads the text as a theme, fills what it lacks
 * from `fallbackTheme`, hands it to `onImport` and empties the box; a text that is no theme stays
 * in the box with an error.
 */
export const useAiThemeImport = (fallbackTheme: DualTheme, onImport: (theme: DualTheme) => void) => {
    const { t } = useTranslation();
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);

    return {
        text,
        error,
        canApply: text.trim().length > 0,
        change: (next: string) => {
            setText(next);
            setError(null);
        },
        clear: () => {
            setText('');
            setError(null);
        },
        apply: () => {
            if (!text.trim()) {
                return;
            }
            try {
                onImport(sanitizeDualTheme(parseAiThemeJsonInput(text) as DualTheme, fallbackTheme));
                setText('');
                setError(null);
            } catch {
                setError(t('options.invalidJsonFormat'));
            }
        },
    };
};

type AiThemeJsonBoxProps = {
    importer: ReturnType<typeof useAiThemeImport>;
    /** The height of the box: a number of lines, or classes that let it fill its place. */
    className?: string;
};

/*
 * The box the JSON is pasted into, and the error under it.
 *
 * 尺寸一律用 rem，不用 px —— 界面缩放动的是**根字号**（androidPhoneFit.css 里 `html`
 * 的 font-size 跟着 `--folia-ui-scale-*` 走）。写死 px 的话，卡片会跟着面板一起变窄，
 * 里面的行高与输入框高度却不动，于是两行字挤到一起、按钮互相压住。
 * 数值按 1rem = 16px 折算，与原先的 px 一一对齐。
 */
export const AiThemeJsonBox: React.FC<AiThemeJsonBoxProps> = ({ importer, className = 'h-[8.25rem]' }) => {
    const { t } = useTranslation();

    return (
        <>
            <TextArea
                value={importer.text}
                onChange={(event) => importer.change(event.target.value)}
                placeholder={t('options.pasteJsonHere')}
                aria-label={t('aiHelp.importJsonTitle')}
                aria-invalid={importer.error ? true : undefined}
                spellCheck={false}
                className={`${FIELD_SURFACE_CLASS} st-scroll block w-full resize-none px-2.5 py-2 font-mono text-xs leading-[1.125rem] ${className}`}
            />
            {importer.error && <p role="alert" className="mt-2 text-xs leading-[1.125rem] text-[color:var(--st-err)]">{importer.error}</p>}
        </>
    );
};
