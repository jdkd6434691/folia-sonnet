import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { modelCanRun, subscribeModelAvailability } from '../../services/analysis/modelAvailability';
import {
    ANALYSIS_MODELS_ENABLED,
    modelStoreSnapshot,
    subscribeModelStore,
    type DownloadableModel,
} from '../../services/analysis/modelStore';
import { useAnalysisModelStore } from '../../stores/useAnalysisModelStore';
import ThemedDialog from '../shared/ThemedDialog';
import { Button, Checkbox } from '@/components/ui';

// src/components/modal/AnalysisModelsPrompt.tsx
// Asks once, a little after startup, whether to fetch the analysis models: automix's beat grid and
// 智能动感模式's beats read the same beat_this export, and automix's stems and 智能动感模式's drums
// read the same htdemucs one. 133MB that used to sit in every installer and every APK, still shipped
// in the desktop app's, and simply absent everywhere else - which is why the question exists.
//
// Mounted once at app level and self-contained, like LegacyModelsPrompt: it draws nothing once it has
// been answered, and nothing at all when the weights are already there (a desktop install that ships
// them never sees this). Both models are offered separately because they are separate downloads -
// 41MB for the beats is not the same ask as 92MB for the stems - and either can be turned on later
// from 播放控制, which is the point of asking rather than deciding for them.
//
// Closing the dialog leaves it for the next launch; "not now" answers it for good.
//
// Drawn only while ANALYSIS_MODELS_ENABLED is on. Off, this mounts and draws nothing at all - the
// question cannot be answered in a way that leads anywhere yet, and asking for 133MB that lands in
// a state nothing can use is worse than not asking.

/** After startup's own work: nothing about this is urgent, and a download is not a surprise to spring. */
const CHECK_DELAY_MS = 6000;

const MODELS: DownloadableModel[] = ['beat_this', 'htdemucs'];

const AnalysisModelsPrompt: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const asked = useAnalysisModelStore(state => state.asked);
    const markAsked = useAnalysisModelStore(state => state.handleMarkAsked);
    const setWanted = useAnalysisModelStore(state => state.handleSetModelWanted);

    // Subscribed, because the answer to "is it already there" arrives a moment after the first paint.
    const weights = React.useSyncExternalStore(subscribeModelAvailability, () => modelCanRun('beat_this') || modelCanRun('htdemucs'));
    const entries = React.useSyncExternalStore(subscribeModelStore, modelStoreSnapshot);

    const [open, setOpen] = useState(false);
    const [chosen, setChosen] = useState<Record<DownloadableModel, boolean>>({ beat_this: true, htdemucs: false });

    useEffect(() => {
        if (asked) return undefined;
        let left = false;
        const timer = setTimeout(() => { if (!left) setOpen(true); }, CHECK_DELAY_MS);
        return () => {
            left = true;
            clearTimeout(timer);
        };
    }, [asked]);

    // A desktop install that still ships the weights has nothing to fetch. First line is the whole
    // feature being switched off: the question has to lead somewhere, so it is not asked at all.
    if (!ANALYSIS_MODELS_ENABLED || asked || weights || !open) return null;

    const busy = MODELS.some(name => chosen[name] && entries[name].phase === 'downloading');

    const confirm = () => {
        for (const name of MODELS) setWanted(name, chosen[name]);
        markAsked();
        setOpen(false);
    };

    const decline = () => {
        for (const name of MODELS) setWanted(name, false);
        markAsked();
        setOpen(false);
    };

    const rowClass = `flex items-start gap-3 rounded-xl border p-3 ${isDaylight ? 'border-black/10' : 'border-white/10'}`;

    return (
        <ThemedDialog
            isOpen
            onClose={() => setOpen(false)}
            isDaylight={isDaylight}
            title={t('options.analysisModelsTitle')}
            description={t('options.analysisModelsDesc')}
            size="s"
        >
            <div className="mb-3.5 space-y-2">
                {MODELS.map(name => (
                    <label key={name} className={rowClass}>
                        <Checkbox
                            checked={chosen[name]}
                            onChange={event => setChosen(previous => ({ ...previous, [name]: event.target.checked }))}
                            className="mt-0.5"
                        />
                        <span className="min-w-0">
                            {/* The same label and explanation the settings row uses: one description
                                of what a model is, not two that can drift apart. */}
                            <span className="block text-sm">
                                {t(name === 'beat_this' ? 'options.analysisModelBeatThis' : 'options.analysisModelHtdemucs')}
                            </span>
                            <span className="block text-[13px] opacity-70">
                                {t(name === 'beat_this' ? 'options.analysisModelBeatThisDesc' : 'options.analysisModelHtdemucsDesc')}
                            </span>
                        </span>
                    </label>
                ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
                {/* Left and quieter: not now is an answer too, and also ends the prompt. */}
                <Button
                    disabled={busy}
                    onClick={decline}
                    className={`mr-auto text-sm underline opacity-50 hover:opacity-80 disabled:opacity-30 ${isDaylight ? 'text-zinc-900' : 'text-white'}`}
                >
                    {t('options.analysisModelsLater')}
                </Button>
                <Button
                    disabled={busy}
                    onClick={confirm}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white/90 flex items-center gap-1.5 disabled:opacity-50"
                >
                    <Download size={14} />
                    {t('options.analysisModelsEnable')}
                </Button>
            </div>
        </ThemedDialog>
    );
};

export default AnalysisModelsPrompt;
