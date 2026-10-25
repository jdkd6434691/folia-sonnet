import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';
import { GridLocateButton } from '../../../../components/app/playing-song-locator/GridLocateButton';
import { GridListSearchButton } from '../../../../components/shared/GridListSearchButton';
import { SidePanelList, TrackListItem } from '../../../../components/shared/SidePanelList';
import { TrackSortDirectionButton, TrackSortMenu } from '../../../../components/shared/TrackSortMenu';
import { Button } from '../../../../components/ui';
import { isSongUnavailable } from '../../../../services/onlineMusic/songAvailability';
import type { SongResult, Theme } from '../../../../types';
import type { TrackSorting } from '../../../core/collection/useTrackSorting';

// src/library/suites/grid/collection/GridViewTracksPanel.tsx
// GridView 的曲目侧栏与右下那颗「列表 / 在此定位」按钮：原 GridView.tsx 的 JSX 原样搬出。

type GridViewTracksPanelProps = {
    /** 侧栏开着（原 showSidePanel）。 */
    isOpen: boolean;
    onClose: () => void;
    title: string;
    tracks: SongResult[];
    isDaylight: boolean;
    theme: Theme;
    /** 焦点卡在侧栏里的行号。 */
    focusedIndex: number;
    /** 每次「定位」都让侧栏滚到那一行。 */
    revealTimes: number;
    /** 本地文件夹的网格自己有大标题，侧栏那一行让给排序控件。 */
    hideTitle: boolean;
    supportsTrackSorting: boolean;
    sorting: TrackSorting;
    /** 是否画右下那颗「在列表里找」的浮动按钮（原 mode === 'tracks' && displayTracks.length > 0）。 */
    showFloatingButton: boolean;
    /** 浮动按钮上方那颗「在此定位」：正在播放且是本集合才有。 */
    showLocateButton: boolean;
    isPlayingSongHere: boolean;
    isLocateAsked: boolean;
    onLocate: () => void;
    onOpenList: () => void;
    onPlay: (track: SongResult) => void;
    onAddToQueue?: (track: SongResult) => void;
    getAlbumTrackLabel: (track: SongResult) => string | null;
};

export const GridViewTracksPanel = ({
    isOpen,
    onClose,
    title,
    tracks,
    isDaylight,
    theme,
    focusedIndex,
    revealTimes,
    hideTitle,
    supportsTrackSorting,
    sorting,
    showFloatingButton,
    showLocateButton,
    isPlayingSongHere,
    isLocateAsked,
    onLocate,
    onOpenList,
    onPlay,
    onAddToQueue,
    getAlbumTrackLabel,
}: GridViewTracksPanelProps) => {
    const { t } = useTranslation();

    return (
        <>
            {/* Bottom Right Floating Button */}
            {showFloatingButton && (
                <GridListSearchButton
                    isDaylight={isDaylight}
                    accentColor={theme.accentColor}
                    listTitle={t('playlist.viewTracks')}
                    searchTitle={t('home.gridSearchPlaceholder')}
                    onOpenList={onOpenList}
                    above={showLocateButton ? (
                        <GridLocateButton
                            isDaylight={isDaylight}
                            accentColor={theme.accentColor}
                            isHere={isPlayingSongHere}
                            isSeeking={isLocateAsked}
                            title={t('playlist.locatePlaying')}
                            onLocate={onLocate}
                        />
                    ) : undefined}
                />
            )}

            {/* Tracks Cut-in Side Panel */}
            {/* 侧栏标题只给非本地文件夹留着：本地文件夹网格本身就有大标题，那一行让给排序控件。 */}
            <SidePanelList
                isOpen={isOpen}
                onClose={onClose}
                title={title}
                items={tracks}
                itemHeight={60}
                isDaylight={isDaylight}
                focusedIndex={focusedIndex}
                revealTimes={revealTimes}
                hideTitle={hideTitle}
                headerLeadingActions={supportsTrackSorting ? (
                    <TrackSortDirectionButton
                        direction={sorting.direction}
                        disabled={sorting.field === 'none'}
                        onDirectionChange={sorting.setDirection}
                    />
                ) : undefined}
                headerActions={(
                    <>
                        {/* The same question as the button over the grid: is the playing song on this page. */}
                        {showLocateButton && (
                            <Button
                                data-list-locate={isPlayingSongHere ? 'here' : 'elsewhere'}
                                title={t('playlist.locatePlaying')}
                                aria-label={t('playlist.locatePlaying')}
                                onClick={onLocate}
                                className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                            >
                                <Crosshair size={18} style={{ color: isPlayingSongHere ? theme.accentColor : undefined }} />
                            </Button>
                        )}
                        {supportsTrackSorting && (
                            <TrackSortMenu
                                presets={sorting.presets}
                                field={sorting.field}
                                direction={sorting.direction}
                                onSelect={sorting.applyPreset}
                            />
                        )}
                    </>
                )}
                renderItem={(track, index, style) => (
                    <TrackListItem
                        key={`${track.id}-${index}`}
                        track={track}
                        index={index}
                        style={style}
                        isUnavailable={isSongUnavailable(track)}
                        isActive={index === focusedIndex}
                        albumTrackLabel={getAlbumTrackLabel(track)}
                        onPlay={() => onPlay(track)}
                        onAddToQueue={onAddToQueue ? () => onAddToQueue(track) : undefined}
                    />
                )}
            />
        </>
    );
};

export default GridViewTracksPanel;
