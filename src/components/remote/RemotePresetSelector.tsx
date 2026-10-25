import React from 'react';
import { motion } from 'framer-motion';
import { Check, Sliders, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VIDEO_EXPORT_PRESET_MAX, VIDEO_EXPORT_PRESET_MIN } from '../../types/videoExport';
import { REMOTE_NO_DRAG_STYLE } from './remoteWindowBridge';
import type { RemoteExportDraft } from './useRemoteExportDraft';
import { Button, TextField } from '../ui';

// src/components/remote/RemotePresetSelector.tsx
// 导出用的预设弹层：左边竖排四份预设，右边改选中那一份的宽高。整层盖在卡片上，
// 自带一层模糊底 —— 遥控窗口是透明窗口，页面没法模糊窗口后面的东西，只能自己铺一层近似的底。

type RemotePresetSelectorProps = {
    isDaylight: boolean;
    draft: RemoteExportDraft;
    onClose: () => void;
};

const RemotePresetSelector: React.FC<RemotePresetSelectorProps> = ({ isDaylight, draft, onClose }) => {
    const { t } = useTranslation();
    const {
        exportPresets,
        selectedPresetId,
        handleSelectExportPreset,
        draftWidth,
        setDraftWidth,
        draftHeight,
        setDraftHeight,
        aspectRatioLabel,
        handleApplyCustomPresetValues,
    } = draft;

    const activePresetIndex = exportPresets.findIndex(preset => preset.id === selectedPresetId) + 1;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute inset-0 z-50 flex flex-col p-3 rounded-[20px] shadow-2xl border overflow-hidden transition-colors duration-300 ${isDaylight ? 'border-black/10' : 'border-white/10'
                }`}
            style={REMOTE_NO_DRAG_STYLE}
        >
            {/* Blurry gradient background for modal */}
            <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                {/* Base */}
                <div className={`absolute inset-0 backdrop-blur-md transition-colors duration-300 ${isDaylight ? 'bg-[#f5f5f4]/95' : 'bg-[#060814]/95'
                    }`} />
                {/* Blurry blobs for modal */}
                {isDaylight ? (
                    <>
                        <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-orange-400/20 blur-[40px]" />
                        <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-rose-300/20 blur-[50px]" />
                    </>
                ) : (
                    <>
                        <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-blue-600/20 blur-[40px]" />
                        <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-indigo-500/15 blur-[50px]" />
                    </>
                )}
            </div>
            <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[13px] font-bold transition-colors ${isDaylight ? 'text-black/90' : 'text-white/90'
                    }`}>{t('remote.presetSelectorTitle')}</span>
                <Button
                    onClick={onClose}
                    className={`flex h-6 w-6 items-center justify-center rounded-full transition ${isDaylight
                        ? 'bg-black/5 text-black/50 hover:bg-black/10 hover:text-black'
                        : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                        }`}
                >
                    <X size={14} />
                </Button>
            </div>
            <div className="flex gap-3 flex-1 overflow-hidden py-0.5">
                {/* Left Column: Vertical Presets List */}
                <div className="flex flex-col gap-2 w-[42%] shrink-0">
                    {exportPresets.map((preset, index) => {
                        const isSelected = preset.id === selectedPresetId;
                        return (
                            <Button
                                key={preset.id}
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => handleSelectExportPreset(preset.id)}
                                className={`flex items-center justify-between rounded-xl p-2 px-3 border transition text-left cursor-pointer flex-1 min-h-[42px] ${isSelected
                                    ? (isDaylight
                                        ? 'bg-zinc-900 border-zinc-900 text-white shadow-md font-bold'
                                        : 'bg-white border-white text-zinc-950 shadow-md font-bold')
                                    : (isDaylight
                                        ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black hover:border-black/10 font-medium'
                                        : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/10 font-medium')
                                    }`}
                            >
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[9px] opacity-60 font-semibold mb-0.5 tracking-wide uppercase truncate">
                                        {t('remote.preset', { index: index + 1 })} ({preset.orientation === 'portrait' ? t('remote.portrait') : t('remote.landscape')})
                                    </span>
                                    <span className="text-xs font-bold truncate">{preset.label}</span>
                                </div>
                                {isSelected && (
                                    <div className={`flex items-center justify-center rounded-full p-0.5 shrink-0 ml-1.5 ${isDaylight ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white'
                                        }`}>
                                        <Check size={10} className="stroke-[3]" />
                                    </div>
                                )}
                            </Button>
                        );
                    })}
                </div>

                {/* Right Column: Customize Form */}
                <div
                    className={`flex flex-col flex-1 min-w-0 rounded-xl border p-2 px-2.5 justify-between transition ${isDaylight
                        ? 'bg-black/5 border-black/5 text-black/80'
                        : 'bg-white/5 border-white/5 text-white/80'
                        }`}
                >
                    <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <Sliders size={11} className="opacity-75" />
                            <span className="text-[9px] opacity-60 font-semibold tracking-wide uppercase">
                                {t('remote.customPreset', { index: activePresetIndex })}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <label
                                className={`flex flex-col rounded-xl px-2 py-1 transition-colors border ${isDaylight
                                    ? 'bg-white/80 border-black/5 focus-within:border-black/25'
                                    : 'bg-zinc-950/35 border-white/5 focus-within:border-white/20'
                                    }`}
                            >
                                <span className="text-[9px] opacity-50 font-semibold">{t('remote.widthPx')}</span>
                                <TextField
                                    type="text"
                                    inputMode="numeric"
                                    value={draftWidth}
                                    onChange={(event) => setDraftWidth(event.currentTarget.value.replace(/[^\d]/g, ''))}
                                    className="bg-transparent text-[11px] font-semibold outline-none w-full"
                                />
                            </label>

                            <label
                                className={`flex flex-col rounded-xl px-2 py-1 transition-colors border ${isDaylight
                                    ? 'bg-white/80 border-black/5 focus-within:border-black/25'
                                    : 'bg-zinc-950/35 border-white/5 focus-within:border-white/20'
                                    }`}
                            >
                                <span className="text-[9px] opacity-50 font-semibold">{t('remote.heightPx')}</span>
                                <TextField
                                    type="text"
                                    inputMode="numeric"
                                    value={draftHeight}
                                    onChange={(event) => setDraftHeight(event.currentTarget.value.replace(/[^\d]/g, ''))}
                                    className="bg-transparent text-[11px] font-semibold outline-none w-full"
                                />
                            </label>
                        </div>

                        {aspectRatioLabel && (
                            <div className="mt-1.5 flex items-center px-0.5">
                                <span className={`text-[9px] font-semibold transition-colors px-1.5 py-0.5 rounded ${isDaylight ? 'bg-black/5 text-black/60' : 'bg-white/5 text-white/60'
                                    }`}>
                                    {t('remote.aspectRatio')} {aspectRatioLabel}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1 mt-1">
                        <div className={`text-[9px] leading-tight opacity-50 ${isDaylight ? 'text-black' : 'text-white'}`}>
                            {t('remote.rangeHint', { min: VIDEO_EXPORT_PRESET_MIN, max: VIDEO_EXPORT_PRESET_MAX })} {t('remote.encodingHint')}
                        </div>
                        <Button
                            onClick={handleApplyCustomPresetValues}
                            className={`flex h-8 items-center justify-center rounded-lg text-[11px] font-bold shadow-sm transition active:scale-[0.98] ${isDaylight
                                ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                                : 'bg-white text-zinc-950 hover:bg-white/90'
                                }`}
                        >
                            {t('remote.saveToPreset', { index: activePresetIndex })}
                        </Button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default RemotePresetSelector;
