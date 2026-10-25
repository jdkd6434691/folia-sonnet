import React from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from './ThemedDialog';
import { Button } from '../ui';

interface PlaylistSelectionDialogItem {
    id: string | number;
    name: string;
    description?: string;
}

interface PlaylistSelectionDialogProps {
    isOpen: boolean;
    title: string;
    description?: string;
    playlists: readonly PlaylistSelectionDialogItem[];
    isDaylight?: boolean;
    onClose: () => void;
    onSelect: (playlistId: string | number) => Promise<void> | void;
    onCreate?: () => void;
    createLabel?: string;
    /**
     * 列表下面多一个「不进歌单，只要曲库里有」这类动作。
     *
     * 有它之后关掉这个弹窗（叉 / 背景 / 返回键）才等于真正的取消 —— 以前关闭就是
     * 「只进曲库」，用户点取消结果歌曲照样进了库。
     */
    secondaryAction?: { label: string; onSelect: () => Promise<void> | void };
}

const PlaylistSelectionDialog: React.FC<PlaylistSelectionDialogProps> = ({
    isOpen,
    title,
    description,
    playlists,
    isDaylight = false,
    onClose,
    onSelect,
    onCreate,
    createLabel,
    secondaryAction,
}) => {
    const { t } = useTranslation();
    const [submittingId, setSubmittingId] = React.useState<string | number | null>(null);
    const [secondaryBusy, setSecondaryBusy] = React.useState(false);
    const panelClass = isDaylight ? 'bg-black/[0.04] border-black/5 hover:bg-black/[0.06]' : 'bg-white/[0.05] border-white/10 hover:bg-white/[0.08]';
    const secondaryButton = secondaryAction ? (
        <Button
            onClick={async () => {
                try {
                    setSecondaryBusy(true);
                    await secondaryAction.onSelect();
                } finally {
                    setSecondaryBusy(false);
                }
            }}
            disabled={submittingId !== null || secondaryBusy}
            className={`w-full rounded-2xl border px-5 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${panelClass}`}
        >
            {secondaryAction.label}
        </Button>
    ) : null;
    React.useEffect(() => {
        if (!isOpen) {
            setSubmittingId(null);
            setSecondaryBusy(false);
        }
    }, [isOpen]);

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={title}
            description={description}
            size="m"
            fill
            panelKind="playlist-selection"
        >
            {/* data-folia-playlist-selection：手机适配 CSS 靠它给「新建歌单」按钮单独排版。 */}
            <div data-folia-playlist-selection="true" className="flex min-h-0 flex-1 flex-col">
            {onCreate && (
                <Button
                    onClick={onCreate}
                    disabled={submittingId !== null}
                    className="st-t-fast mb-3 flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--st-fill)] text-[13px] transition-colors enabled:hover:bg-[var(--st-fill2)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <Plus size={16} />
                    {createLabel || t('localMusic.saveQueueAsPlaylist') || 'Create Playlist'}
                </Button>
            )}
            {playlists.length > 0 ? (
                // The list scrolls; the line above it stays.
                // data-folia-playlist-list：手机适配 CSS 靠它收掉写死的高度（src/styles/androidPhoneFit.css）。
                <div data-folia-playlist-list="true" className="st-card st-scroll min-h-0 overflow-y-auto rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                    {playlists.map((playlist) => (
                        <Button
                            key={playlist.id}
                            data-folia-playlist-option="true"
                            onClick={async () => {
                                try {
                                    setSubmittingId(playlist.id);
                                    await onSelect(playlist.id);
                                    onClose();
                                } finally {
                                    setSubmittingId(null);
                                }
                            }}
                            disabled={submittingId !== null}
                            className="st-row st-focus-inside st-t-fast relative flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors enabled:hover:bg-[var(--st-fill)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm leading-5">{playlist.name}</div>
                                {playlist.description && (
                                    <div className="truncate text-xs leading-[18px] text-[color:var(--st-t2)]">{playlist.description}</div>
                                )}
                            </div>
                            <Plus size={16} className="shrink-0 text-[color:var(--st-t3)]" />
                        </Button>
                    ))}
                </div>
            ) : (
                <div className="py-8 text-center text-[13px] text-[color:var(--st-t3)]">
                    {t('localMusic.noPlaylistsFound') || 'No playlists yet'}
                </div>
            )}
            {secondaryButton}
            </div>
        </ThemedDialog>
    );
};

export default PlaylistSelectionDialog;
