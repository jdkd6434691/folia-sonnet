import { AnimatePresence, motion, type DragControls, type MotionValue } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import type React from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

// src/library/suites/grid/collection/GridViewCanvas.tsx
// GridView 中间那块六边形画布：拖拽面板、加载 / 空 / 失败页与卡片层。原 GridView.tsx 的 JSX 原样搬出。

type LoadFailureSaid = { title: string; note?: string; quote?: { text: string; code?: string } };

type GridViewCanvasProps = {
    containerRef: RefObject<HTMLDivElement | null>;
    dragControls: DragControls;
    /** 首屏还在读：中间那颗加载说明（替身卡在场时由替身说）。 */
    showLoading: boolean;
    hasStandIn: boolean;
    gridItemCount: number;
    loadFailureSaid: LoadFailureSaid | null;
    hasSearchQuery: boolean;
    loadError: unknown;
    dragBounds: { left: number; right: number; top: number; bottom: number };
    dragX: MotionValue<number>;
    dragY: MotionValue<number>;
    onDragStart: () => void;
    onDragEnd: () => void;
    cards: React.ReactNode;
};

export const GridViewCanvas = ({
    containerRef,
    dragControls,
    showLoading,
    hasStandIn,
    gridItemCount,
    loadFailureSaid,
    hasSearchQuery,
    loadError,
    dragBounds,
    dragX,
    dragY,
    onDragStart,
    onDragEnd,
    cards,
}: GridViewCanvasProps) => {
    const { t } = useTranslation();

    return (
            <div
                ref={containerRef}
                data-folia-grid-canvas="true"
                onPointerDown={(event) => {
                    if (event.button !== 0) return; // 仅限鼠标左键或主要指针拖动

                    const target = event.target as HTMLElement;
                    // 如果点击了按钮、输入框、链接或设置面板，则不触发拖动
                    if (
                        target.closest('button') ||
                        target.closest('input') ||
                        target.closest('a') ||
                        target.closest('textarea') ||
                        target.closest('.theme-glass-panel')
                    ) {
                        return;
                    }

                    // 向上遍历判断是否在卡片内部点击了具有 cursor-pointer 的非卡片元素（例如歌手、专辑链接）
                    let current: HTMLElement | null = target;
                    while (current && !current.classList.contains('theme-polaroid-card')) {
                        if (current.classList.contains('cursor-pointer')) {
                            return;
                        }
                        current = current.parentElement;
                    }

                    dragControls.start(event);
                }}
                className="w-full flex-1 relative flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden"
                style={{ touchAction: 'none' }}
            >
                {showLoading ? (
                    // (The stand-in says it where it shows: both stand at the middle.)
                    !hasStandIn && (
                        <div className="flex flex-col items-center gap-4 opacity-50">
                            <Loader2 className="animate-spin" size={32} />
                            <span className="text-sm font-semibold font-sans">{t('playlist.loading')}</span>
                        </div>
                    )
                ) : gridItemCount === 0 ? (
                    <div className="max-w-md px-6 text-center text-sm font-sans opacity-40">
                        {loadFailureSaid
                            ? (
                                <>
                                    <p>{loadFailureSaid.title}</p>
                                    {loadFailureSaid.note && <p>{loadFailureSaid.note}</p>}
                                    {loadFailureSaid.quote && (
                                        <p className="mt-1 text-xs [overflow-wrap:anywhere]">
                                            {loadFailureSaid.quote.text}
                                            {loadFailureSaid.quote.code && <code className="ml-1.5 font-mono">{loadFailureSaid.quote.code}</code>}
                                        </p>
                                    )}
                                </>
                            )
                            : hasSearchQuery ? (t('home.gridSearchNoResults'))
                                // Given no tracks because their read failed: not a collection that holds none.
                                : loadError && !hasSearchQuery ? t('playlist.loadFailedPlain') : (t('home.loadingLibrary'))}
                    </div>
                ) : (
                    <motion.div
                        data-grid-canvas
                        drag
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={dragBounds}
                        dragElastic={0.05}
                        dragTransition={{ power: 0.16, timeConstant: 220 }}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        style={{ x: dragX, y: dragY, background: 'rgba(0,0,0,0)', touchAction: 'none' }}
                        className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing bg-transparent"
                    >
                        <AnimatePresence initial={false}>
                            {cards}
                        </AnimatePresence>
                    </motion.div>
                )}
            </div>
    );
};

export default GridViewCanvas;
