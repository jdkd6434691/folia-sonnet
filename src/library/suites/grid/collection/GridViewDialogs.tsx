import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../../../../components/shared/ConfirmDialog';
import PlaylistSelectionDialog from '../../../../components/shared/PlaylistSelectionDialog';
import TextInputDialog from '../../../../components/shared/TextInputDialog';
import type { LibraryPlaylistOption } from '../../../core/shared/ports.contract';
import type { SongResult } from '../../../../types';

// src/library/suites/grid/collection/GridViewDialogs.tsx
// GridView 宿主的四个对话框（加入歌单 / 新建歌单 / 删歌确认 / 删文件夹确认），原 GridView.tsx 的 JSX 原样搬出。

export type PendingLocalRemoval = { track: SongResult; entryKey: string };

type GridViewDialogsProps = {
    isPlaylistPickerOpen: boolean;
    playlists: readonly LibraryPlaylistOption[];
    isCreatePlaylistOpen: boolean;
    pendingLocalRemoval: PendingLocalRemoval | null;
    isDeleteFolderOpen: boolean;
    /** 删文件夹的文案按集合名判断是根目录还是子目录。 */
    collectionName?: string;
    isDaylight: boolean;
    onClosePlaylistPicker: () => void;
    onSelectPlaylist: (playlistId: string | number) => void;
    onRequestCreatePlaylist: () => void;
    onCloseCreatePlaylist: () => void;
    onCreatePlaylist: (name: string) => void;
    onConfirmLocalRemoval: (pending: PendingLocalRemoval) => void;
    onCloseLocalRemoval: () => void;
    onConfirmDeleteFolder: () => void;
    onCloseDeleteFolder: () => void;
};

export const GridViewDialogs = ({
    isPlaylistPickerOpen,
    playlists,
    isCreatePlaylistOpen,
    pendingLocalRemoval,
    isDeleteFolderOpen,
    collectionName,
    isDaylight,
    onClosePlaylistPicker,
    onSelectPlaylist,
    onRequestCreatePlaylist,
    onCloseCreatePlaylist,
    onCreatePlaylist,
    onConfirmLocalRemoval,
    onCloseLocalRemoval,
    onConfirmDeleteFolder,
    onCloseDeleteFolder,
}: GridViewDialogsProps) => {
    const { t } = useTranslation();

    return (
        <>
            <PlaylistSelectionDialog
                isOpen={isPlaylistPickerOpen}
                title={t('localMusic.addToPlaylist')}
                playlists={playlists}
                onClose={onClosePlaylistPicker}
                onSelect={(playlistId) => {
                    onSelectPlaylist(playlistId);
                    onClosePlaylistPicker();
                }}
                onCreate={onRequestCreatePlaylist}
                createLabel={t('localMusic.createPlaylist')}
                isDaylight={isDaylight}
            />
            <TextInputDialog
                isOpen={isCreatePlaylistOpen}
                title={t('localMusic.createPlaylist')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('localMusic.createPlaylist')}
                onClose={onCloseCreatePlaylist}
                onConfirm={(name) => {
                    onCreatePlaylist(name);
                }}
                isDaylight={isDaylight}
            />
            <ConfirmDialog
                isOpen={Boolean(pendingLocalRemoval)}
                title={t('localMusic.deleteSongTitle')}
                description={t('localMusic.deleteSongMessage', { name: pendingLocalRemoval?.track.name ?? '' })}
                confirmText={t('localMusic.deleteFromLibrary')}
                confirmVariant="danger"
                onConfirm={() => {
                    if (pendingLocalRemoval) onConfirmLocalRemoval(pendingLocalRemoval);
                }}
                onClose={onCloseLocalRemoval}
                isDaylight={isDaylight}
            />
            <ConfirmDialog
                isOpen={isDeleteFolderOpen}
                title={t('localMusic.deleteFolderTitle')}
                description={t(collectionName?.replace(/\\/g, '/').includes('/')
                    ? 'localMusic.deleteSubfolderMessage' : 'localMusic.deleteRootFolderMessage', { folderName: collectionName })}
                confirmText={t('localMusic.deleteFromLibrary')}
                confirmVariant="danger"
                onConfirm={onConfirmDeleteFolder}
                onClose={onCloseDeleteFolder}
                isDaylight={isDaylight}
            />
        </>
    );
};

export default GridViewDialogs;
