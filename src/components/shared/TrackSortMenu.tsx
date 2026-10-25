import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowDownAZ,
    ArrowDownUp,
    ArrowUpAZ,
    CalendarClock,
    Check,
    ChevronDown,
    Clock,
    FileMusic,
    Heart,
    ListMusic,
    ListOrdered,
    Play,
    Type,
    User,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongSortDirection, SongSortField } from '../../utils/songSorting';
import { findSongSortPreset, type SongSortPreset } from '../../library/core/collection/songSortOptions';
import { Button } from '../ui';

// src/components/shared/TrackSortMenu.tsx
// 曲目列表的排序菜单。选项不在这里写死：renderer 把「这个列表排得了哪些项」传进来，
// 菜单照着渲染——网格侧栏和 bravais 列表面板因此永远给出同一份列表、同一个控件。
//
// 菜单是网页自己画的：之前 bravais 面板用原生 select，点下去弹的是浏览器 / 系统那套
// spinner 弹窗，跟周围的界面完全不是一个东西（撕裂感就出在这）。原生弹层还吃不到主题变量。
//
// 弹层 portal 到 body（与 CustomSelect 同一条纪律）：就地挂的浮层会被任何祖先的
// overflow / transform 裁掉，也可能继承到 bravais 那套「只投影不画 UI」锚点的
// pointer-events: none —— 弹出来却什么都点不动。

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

const FIELD_ICONS: Partial<Record<SongSortField, IconComponent>> = {
    none: ListMusic,
    addedAt: Clock,
    title: Type,
    artist: User,
    liked: Heart,
    playCount: Play,
    fileName: FileMusic,
    fileLastModified: CalendarClock,
    albumTrack: ListOrdered,
};

const iconFor = (field: SongSortField): IconComponent => FIELD_ICONS[field] ?? ArrowDownUp;

const MENU_WIDTH = 208;
const MENU_MAX_HEIGHT = 320;
const MENU_GAP = 6;
const VIEWPORT_GUTTER = 8;
/** 每一项大致的高度，用来决定往上翻还是往下展开（菜单还没渲染，量不到真实高度）。 */
const ROW_HEIGHT = 34;

type MenuPlacement = {
    left: number;
    maxHeight: number;
    placement: 'top' | 'bottom';
    top?: number;
    bottom?: number;
};

type TrackSortMenuProps = {
    presets: readonly SongSortPreset[];
    field: SongSortField;
    direction: SongSortDirection;
    onSelect: (preset: SongSortPreset) => void;
    /**
     * 'icon' 是网格侧栏那颗 32px 圆按钮（地方小）；
     * 'label' 把当前排序方式的名字写在按钮上，用于列表面板这类有横向空间的地方——
     * 换成图标按钮之后，用户就看不出列表现在按什么排了。
     */
    variant?: 'icon' | 'label';
};

export const TrackSortMenu: React.FC<TrackSortMenuProps> = ({
    presets,
    field,
    direction,
    onSelect,
    variant = 'icon',
}) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [menuPlacement, setMenuPlacement] = useState<MenuPlacement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const StrategyIcon = iconFor(field);
    const activePreset = findSongSortPreset(field, direction);

    const { primary, legacy } = useMemo(() => ({
        primary: presets.filter(preset => preset.group === 'primary'),
        legacy: presets.filter(preset => preset.group === 'legacy'),
    }), [presets]);

    const updatePlacement = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const wanted = presets.length * ROW_HEIGHT + 12;
        const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_GUTTER;
        const spaceAbove = rect.top - MENU_GAP - VIEWPORT_GUTTER;
        const placement: MenuPlacement['placement'] = spaceBelow < wanted && spaceAbove > spaceBelow
            ? 'top'
            : 'bottom';
        const left = Math.max(
            VIEWPORT_GUTTER,
            Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER),
        );

        setMenuPlacement({
            left,
            placement,
            maxHeight: Math.max(96, Math.min(MENU_MAX_HEIGHT, placement === 'top' ? spaceAbove : spaceBelow)),
            ...(placement === 'top'
                ? { bottom: window.innerHeight - rect.top + MENU_GAP }
                : { top: rect.bottom + MENU_GAP }),
        });
    }, [presets.length]);

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node;
            // 菜单在 body 上，不在 containerRef 里，两边都要看一眼。
            if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setIsOpen(false);
        };

        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) {
            setMenuPlacement(null);
            return;
        }

        updatePlacement();
        window.addEventListener('resize', updatePlacement);
        window.addEventListener('scroll', updatePlacement, true);
        return () => {
            window.removeEventListener('resize', updatePlacement);
            window.removeEventListener('scroll', updatePlacement, true);
        };
    }, [isOpen, updatePlacement]);

    const items = (group: readonly SongSortPreset[]) => group.map(preset => (
        <SortFieldButton
            key={preset.id}
            active={activePreset?.id === preset.id}
            icon={React.createElement(iconFor(preset.field), { size: 15 })}
            label={t(preset.labelKey)}
            onClick={() => {
                onSelect(preset);
                setIsOpen(false);
            }}
        />
    ));

    const menu = (
        <AnimatePresence>
            {isOpen && menuPlacement && (
                <motion.div
                    ref={menuRef}
                    initial={{ opacity: 0, y: menuPlacement.placement === 'top' ? 6 : -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: menuPlacement.placement === 'top' ? 6 : -6, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    role="menu"
                    data-track-sort-menu=""
                    className="fixed z-[9999] overflow-y-auto rounded-2xl border p-1.5 shadow-xl backdrop-blur-2xl theme-glass-panel"
                    style={{
                        left: menuPlacement.left,
                        width: MENU_WIDTH,
                        maxHeight: menuPlacement.maxHeight,
                        top: menuPlacement.top,
                        bottom: menuPlacement.bottom,
                        transformOrigin: menuPlacement.placement === 'top' ? 'bottom right' : 'top right',
                    }}
                >
                    {items(primary)}
                    {legacy.length > 0 && (
                        <>
                            <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
                            {items(legacy)}
                        </>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );

    const activeLabel = activePreset ? t(activePreset.labelKey) : t('localMusic.sortSongs');

    return (
        <div
            ref={containerRef}
            data-ponder="local-track-sorting"
            className={variant === 'label' ? 'relative min-w-0 flex-1' : 'relative shrink-0'}
        >
            {variant === 'label' ? (
                <Button
                    ref={triggerRef}
                    onClick={() => setIsOpen(current => !current)}
                    aria-label={t('localMusic.sortSongs')}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    tip={activeLabel}
                    data-track-sort-trigger=""
                    className="flex w-full min-w-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-colors"
                    style={{
                        borderColor: 'var(--border-color)',
                        color: 'var(--text-primary)',
                        background: 'var(--overlay-medium)',
                    }}
                >
                    <StrategyIcon size={14} className="shrink-0 opacity-65" />
                    <span className="min-w-0 flex-1 truncate text-left">{activeLabel}</span>
                    <ChevronDown
                        size={14}
                        className={`shrink-0 opacity-70 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                </Button>
            ) : (
                <Button
                    ref={triggerRef}
                    onClick={() => setIsOpen(current => !current)}
                    aria-label={t('localMusic.sortSongs')}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    tip={t('localMusic.sortSongs')}
                    data-track-sort-trigger=""
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                        isOpen ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/10 dark:hover:bg-white/10'
                    }`}
                >
                    <StrategyIcon size={16} />
                </Button>
            )}

            {typeof document !== 'undefined' && createPortal(menu, document.body)}
        </div>
    );
};

const DIRECTION_BUTTON_CLASS = 'flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10';

/**
 * 升降序开关。`className` 给了就整体换掉（bravais 传 `bravais-seam-icon`，跟缝里其它按钮同皮），
 * 不给就用默认那颗圆形按钮。
 */
export const TrackSortDirectionButton: React.FC<{
    direction: SongSortDirection;
    disabled?: boolean;
    onDirectionChange: (direction: SongSortDirection) => void;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>> = ({
    direction,
    disabled = false,
    onDirectionChange,
    className,
    ...rest
}) => {
    const { t } = useTranslation();
    const DirectionIcon = direction === 'asc' ? ArrowDownAZ : ArrowUpAZ;
    const nextDirection = direction === 'asc' ? 'desc' : 'asc';

    return (
        <Button
            {...rest}
            disabled={disabled}
            onClick={() => onDirectionChange(nextDirection)}
            aria-label={rest['aria-label'] ?? t('localMusic.sortDirection')}
            tip={rest.title ?? t(direction === 'asc' ? 'localMusic.sortAscending' : 'localMusic.sortDescending')}
            className={className ? `${className} disabled:opacity-40` : `${DIRECTION_BUTTON_CLASS} disabled:opacity-40 disabled:hover:bg-transparent`}
        >
            <DirectionIcon size={16} />
        </Button>
    );
};

const SortFieldButton: React.FC<{
    active: boolean;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
    <Button
        role="menuitemradio"
        aria-checked={active}
        onClick={onClick}
        aria-label={label}
        data-track-sort-item=""
        className={`relative flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
            active ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
        }`}
    >
        <span className="opacity-65">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && <Check size={14} className="opacity-80" />}
    </Button>
);
