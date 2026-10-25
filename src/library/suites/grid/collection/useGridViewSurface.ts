import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import type { CollectionMutationController, CollectionMutationSnapshot } from '../../../core/collection/mutations/mutations.contract';
import { buildCoreSurfaceParams, buildGridSurfaceState, runGridSurfaceAction } from '../../../core/collection/collectionSurface';
import { useGridSurfaceRegistration } from '../../../../hooks/useGridSurfaceRegistration';
import type { TrackSorting } from '../../../core/collection/useTrackSorting';
import type { SongResult } from '../../../../types';

// src/library/suites/grid/collection/useGridViewSurface.ts
// GridView 发布给命令面板的集合 surface：core 动作（播放范围、排序、重新拉取、来源维护、订阅）加上网格自己的
// 信息面板 / 曲目侧栏 / 编辑模式。原 GridView.tsx 的 buildCoreSurfaceParams + 注册调用原样搬出。

export interface GridViewSurfaceParams {
    isInteractive: boolean;
    declaredActions?: LibraryDeclaredActions;
    contextActionTracks: SongResult[];
    hasSearchQuery: boolean;
    supportsLocalTrackSorting: boolean;
    supportsTrackSorting: boolean;
    sorting: TrackSorting;
    canReloadThisCollection: boolean;
    loading: boolean;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[], options?: { suppressToast?: boolean }) => number | void;
    reloadOnlineCollection: () => void;
    mutationSnapshot: CollectionMutationSnapshot;
    mutations: CollectionMutationController | null;
    hasCutInPanel: boolean;
    mode: 'collection' | 'tracks';
    displayTrackCount: number;
    canEditPlaylist: boolean;
    isCutInPanelOpen: boolean;
    isTrackListOpen: boolean;
    isEditMode: boolean;
    toggleInfoPanel: () => void;
    toggleTrackList: () => void;
    toggleEditMode: () => void;
}

export const useGridViewSurface = ({
    isInteractive,
    declaredActions,
    contextActionTracks,
    hasSearchQuery,
    supportsLocalTrackSorting,
    supportsTrackSorting,
    sorting,
    canReloadThisCollection,
    loading,
    onPlayAll,
    onAddAllToQueue,
    reloadOnlineCollection,
    mutationSnapshot,
    mutations,
    hasCutInPanel,
    mode,
    displayTrackCount,
    canEditPlaylist,
    isCutInPanelOpen,
    isTrackListOpen,
    isEditMode,
    toggleInfoPanel,
    toggleTrackList,
    toggleEditMode,
}: GridViewSurfaceParams) => {
    const gridSurfaceParams = buildCoreSurfaceParams({
        declaredActions,
        filteredTrackCount: contextActionTracks.length,
        isFilterActive: hasSearchQuery,
        supportsLocalTrackSorting,
        availableSortPresets: supportsTrackSorting ? sorting.presets : [],
        sortField: sorting.field,
        sortDirection: sorting.direction,
        setSortField: sorting.setField,
        setSortDirection: sorting.setDirection,
        setSortPreset: sorting.applyPreset,
        canReloadOnlineCollection: canReloadThisCollection && !loading,
        playFiltered: () => onPlayAll?.(contextActionTracks),
        enqueueFiltered: () => onAddAllToQueue?.(contextActionTracks),
        reloadOnlineCollection,
        mutationSnapshot,
        mutations: mutations ?? null,
    }, {
        hasInfoPanel: hasCutInPanel,
        hasTrackList: mode === 'tracks' && displayTrackCount > 0,
        canEditPlaylist,
        isInfoPanelOpen: isCutInPanelOpen,
        isTrackListOpen,
        isEditMode,
        toggleInfoPanel,
        toggleTrackList,
        toggleEditMode,
    });
    useGridSurfaceRegistration({
        isInteractive,
        getState: () => buildGridSurfaceState(gridSurfaceParams),
        run: (action) => runGridSurfaceAction(action, gridSurfaceParams),
    });
};
