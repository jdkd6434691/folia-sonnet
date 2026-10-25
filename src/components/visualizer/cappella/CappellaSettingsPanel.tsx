import React, { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVisualizerAssetStore } from '../../../stores/useVisualizerAssetStore';
import { DEFAULT_CAPPELLA_TUNING, type CappellaTuning } from '../../../types';
import { Button, Group, Reveal, Row, Segmented, Status, Toggle, Tooltip, type SettingsGroupDef } from '../../modal/settings/kit';
import { TextField } from '../../ui';
import { type VisualizerSettingsPanelProps } from '../definition';

// src/components/visualizer/cappella/CappellaSettingsPanel.tsx
// Cappella's settings: emoji messages, the avatar preview and the listener's own picture packs.
const CAPPELLA_GROUP: SettingsGroupDef = { id: 'vis-cappella', titleKey: 'options.cappellaSettings' };
const resolveCappellaTuning = (
    tuning: CappellaTuning | undefined,
    hasCustomEmojiPack: boolean,
): CappellaTuning => ({
    showEmoMessages: tuning?.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
    emojiPackSource: tuning?.emojiPackSource === 'custom' && hasCustomEmojiPack
        ? 'custom'
        : 'builtin',
    avatarSource: tuning?.avatarSource === 'builtin' || tuning?.avatarSource === 'color' || tuning?.avatarSource === 'cover' || tuning?.avatarSource === 'custom'
        ? tuning.avatarSource
        : DEFAULT_CAPPELLA_TUNING.avatarSource,
});

/** The uploaded pictures of a pack, five to a line; an empty pack shows five numbered places. */
const CappellaImageSlots: React.FC<{
    images: ReadonlyArray<{ id: string; name: string; url: string }>;
    emptyName: string;
    round?: boolean;
}> = ({ images, emptyName, round }) => {
    const slots = images.length > 0 ? images : Array.from({ length: 5 }, () => null);

    return (
        <div className="grid grid-cols-5 gap-2">
            {slots.map((image, index) => (
                <Tooltip
                    key={image?.id ?? `empty-${index}`}
                    text={image?.name ?? emptyName}
                    className={`grid aspect-square place-items-center overflow-hidden bg-[var(--st-fill)] text-[11px] text-[color:var(--st-t3)] ${round ? 'rounded-full' : 'rounded-lg'}`}
                >
                    {image ? (
                        <img src={image.url} alt={image.name} className={`h-full w-full ${round ? 'object-cover' : 'object-contain'}`} />
                    ) : index + 1}
                </Tooltip>
            ))}
        </div>
    );
};

export const CappellaSettingsPanel: React.FC<VisualizerSettingsPanelProps<CappellaTuning>> = ({
    t,
    tuning: cappellaTuning,
    onTuningChange: onCappellaTuningChange,
    settings: {
        handleImportCustomCappellaEmojiPack: onImportCappellaCustomEmojiPack,
        handleClearCustomCappellaEmojiPack: onClearCappellaCustomEmojiPack,
        handleImportCustomCappellaAvatar: onImportCappellaCustomAvatar,
        handleClearCustomCappellaAvatar: onClearCappellaCustomAvatar,
    },
}) => {
    // The listener's own pictures and whether they are still being read back: the style's own, so the panel takes them itself.
    const {
        cappellaCustomEmojiImages,
        isLoadingCappellaCustomEmojiPack: isCappellaCustomEmojiPackLoading,
        cappellaCustomAvatarImages,
        isLoadingCappellaCustomAvatarPack: isCappellaCustomAvatarLoading,
    } = useVisualizerAssetStore(useShallow(state => ({
        cappellaCustomEmojiImages: state.cappellaCustomEmojiImages,
        isLoadingCappellaCustomEmojiPack: state.isLoadingCappellaCustomEmojiPack,
        cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
        isLoadingCappellaCustomAvatarPack: state.isLoadingCappellaCustomAvatarPack,
    })));
    const cappellaCustomEmojiCount = cappellaCustomEmojiImages.length;
    const hasCappellaCustomEmojiPack = cappellaCustomEmojiCount > 0;
    const hasCappellaCustomAvatar = cappellaCustomAvatarImages.length > 0;
    const emojiFileInputRef = useRef<HTMLInputElement | null>(null);
    const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isImportingAvatar, setIsImportingAvatar] = useState(false);
    const resolvedTuning = resolveCappellaTuning(cappellaTuning, hasCappellaCustomEmojiPack);

    const handleImportClick = () => {
        setFeedback(null);
        emojiFileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length === 0 || !onImportCappellaCustomEmojiPack) {
            return;
        }

        setIsImporting(true);
        setFeedback(null);
        try {
            const result = await onImportCappellaCustomEmojiPack(files);
            if (result.ok) {
                setFeedback(t('options.cappellaEmojiImportSuccess'));
            } else {
                setFeedback(result.error || t('options.cappellaEmojiImportFailed'));
            }
        } finally {
            setIsImporting(false);
        }
    };

    const handleClearCustomPack = async () => {
        if (!onClearCappellaCustomEmojiPack) {
            return;
        }

        setFeedback(null);
        await onClearCappellaCustomEmojiPack();
        setFeedback(t('options.cappellaEmojiCleared'));
    };

    const handleAvatarImportClick = () => {
        setFeedback(null);
        avatarFileInputRef.current?.click();
    };

    const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length === 0 || !onImportCappellaCustomAvatar) {
            return;
        }

        setIsImportingAvatar(true);
        setFeedback(null);
        try {
            const result = await onImportCappellaCustomAvatar(files);
            if (result.ok) {
                setFeedback(t('options.cappellaAvatarImportSuccess'));
            } else {
                setFeedback(result.error || t('options.cappellaAvatarImportFailed'));
            }
        } finally {
            setIsImportingAvatar(false);
        }
    };

    const handleClearCustomAvatar = async () => {
        if (!onClearCappellaCustomAvatar) {
            return;
        }

        setFeedback(null);
        await onClearCappellaCustomAvatar();
        setFeedback(t('options.cappellaAvatarCleared'));
    };

    return (
        <Group def={CAPPELLA_GROUP}>
            <Row
                label={t('options.cappellaAvatarSource')}
                below={(
                    <Segmented
                        fill
                        value={resolvedTuning.avatarSource}
                        options={[
                            { value: 'cover', label: t('options.cappellaAvatarSourceCover') },
                            { value: 'builtin', label: t('options.cappellaAvatarSourceBuiltin') },
                            { value: 'color', label: t('options.cappellaAvatarSourceColor') },
                            { value: 'custom', label: t('options.cappellaAvatarSourceCustom'), disabled: !hasCappellaCustomAvatar },
                        ]}
                        onChange={(next) => onCappellaTuningChange?.({ avatarSource: next })}
                    />
                )}
            />
            <Row
                label={t('options.cappellaAvatarPreview')}
                hint={hasCappellaCustomAvatar
                    ? `${t('options.cappellaEmojiCount')} ${cappellaCustomAvatarImages.length}`
                    : t('options.cappellaAvatarUploadHint')}
                below={<CappellaImageSlots round images={cappellaCustomAvatarImages} emptyName={t('options.cappellaEmojiEmptySlot')} />}
            >
                <Button onClick={handleAvatarImportClick} disabled={isImportingAvatar || isCappellaCustomAvatarLoading}>
                    {isImportingAvatar ? t('options.cappellaAvatarUploading') : t('options.cappellaAvatarUpload')}
                </Button>
                <Button
                    onClick={() => void handleClearCustomAvatar()}
                    disabled={!hasCappellaCustomAvatar || isImportingAvatar || isCappellaCustomAvatarLoading}
                >
                    {t('options.cappellaAvatarClear')}
                </Button>
                <TextField
                    ref={avatarFileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => void handleAvatarFileChange(event)}
                />
            </Row>
            <Row label={t('options.cappellaShowEmoMessages')}>
                <Toggle
                    checked={resolvedTuning.showEmoMessages}
                    onChange={(next) => onCappellaTuningChange?.({ showEmoMessages: next })}
                />
            </Row>
            <Reveal when={resolvedTuning.showEmoMessages}>
                <Row sub label={t('options.cappellaEmojiSource')}>
                    <Segmented
                        value={resolvedTuning.emojiPackSource}
                        options={[
                            { value: 'builtin', label: t('options.cappellaEmojiSourceBuiltin') },
                            { value: 'custom', label: t('options.cappellaEmojiSourceCustom'), disabled: !hasCappellaCustomEmojiPack },
                        ]}
                        onChange={(next) => onCappellaTuningChange?.({ emojiPackSource: next })}
                    />
                </Row>
                <Row
                    sub
                    label={t('options.cappellaEmojiPreview')}
                    hint={hasCappellaCustomEmojiPack
                        ? `${t('options.cappellaEmojiCount')} ${cappellaCustomEmojiCount}`
                        : t('options.cappellaEmojiUploadHint')}
                    below={<CappellaImageSlots images={cappellaCustomEmojiImages} emptyName={t('options.cappellaEmojiEmptySlot')} />}
                >
                    <Button onClick={handleImportClick} disabled={isImporting || isCappellaCustomEmojiPackLoading}>
                        {isImporting ? t('options.cappellaEmojiUploading') : t('options.cappellaEmojiUpload')}
                    </Button>
                    <Button
                        onClick={() => void handleClearCustomPack()}
                        disabled={!hasCappellaCustomEmojiPack || isImporting || isCappellaCustomEmojiPackLoading}
                    >
                        {t('options.cappellaEmojiClear')}
                    </Button>
                    <TextField
                        ref={emojiFileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => void handleFileChange(event)}
                    />
                </Row>
            </Reveal>
            {feedback && <Row label={<Status>{feedback}</Status>} />}
        </Group>
    );
};
