import React, { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { useSleepTimerStore } from '../../../stores/useSleepTimerStore';
import { Toggle } from '../../modal/settings/kit';
import { canExitApp } from '../../../platform/foliaNative';
import {
    formatSleepTimerClock,
    formatSleepTimerRemaining,
    hasSleepTimerDelay,
    isSleepTimerTargetTomorrow,
    readSleepTimerTotalMinutes,
    resolveSleepTimerDelayMs,
    SLEEP_TIMER_HOURS_MAX,
    SLEEP_TIMER_MINUTES_MAX,
    type SleepTimerEndAction,
    type SleepTimerMode,
    type SleepTimerPlan,
} from '../../../services/sleepTimerPlan';
import { Button, TextField } from '../../ui';

// src/components/panelTab/controls/SleepTimerRow.tsx
// 控制面板里的「定时关闭」：三种定时方式（多少分钟后 / 多少小时后 / 到几点）加两种结束方式
// （暂停播放 / 退出应用），外加还剩多久。
//
// 默认收起 —— 控制页就那么宽，几个控制段全摊开会把下面的外观区顶出屏；这一行的标题右侧始终
// 显示当前配置（或正在跑的剩余时间），不展开也看得见它在做什么。
// 「退出应用」只在真有关得掉的那条路时才出现（桌面端 Electron quitApp、安卓走原生 exitApp），
// 浏览器里摆着也只能退化成暂停，不如干脆不给。

interface SleepTimerRowProps {
    theme: Theme;
    isDaylight: boolean;
}

/** 只吃数字的文本框：非数字一律不落进值里 —— 安卓软键盘什么都敢往 key 里塞。 */
const SleepTimerInput: React.FC<{
    isDaylight: boolean;
    label: string;
    max: number;
    maxLength: number;
    value: number;
    onChange: (next: number) => void;
}> = ({ isDaylight, label, max, maxLength, value, onChange }) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const digits = event.currentTarget.value.replace(/\D/g, '');
        if (digits === '') {
            onChange(0);
            return;
        }
        const next = Number(digits);
        // 超过上限保持原样（不截断成 99）：截断等于替用户改写了他刚敲进去的数。
        if (next > max) return;
        onChange(next);
    };

    return (
        <TextField
            type="text"
            inputMode="numeric"
            maxLength={maxLength}
            value={String(value)}
            onChange={handleChange}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={label}
            className={`w-14 rounded-lg border px-2 py-1.5 text-center text-xs tabular-nums outline-none transition-colors ${isDaylight
                ? 'border-black/10 bg-white/60 text-zinc-900'
                : 'border-white/10 bg-black/40 text-white'
                }`}
        />
    );
};

/** 一排互斥的小选项（定时方式 / 结束方式）。 */
const SleepTimerChips: React.FC<{
    options: { id: string; label: string }[];
    activeId: string;
    onSelect: (id: string) => void;
    isDaylight: boolean;
    accentColor: string;
}> = ({ options, activeId, onSelect, isDaylight, accentColor }) => (
    <div className={`flex min-w-0 flex-1 gap-1 rounded-lg p-0.5 ${isDaylight ? 'bg-black/5' : 'bg-black/25'}`}>
        {options.map(option => {
            const active = option.id === activeId;
            return (
                <Button
                    key={option.id}
                    aria-pressed={active}
                    onClick={() => onSelect(option.id)}
                    className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-[11px] font-semibold transition-opacity ${active
                        ? (isDaylight ? 'bg-white shadow-sm' : 'bg-white/10')
                        : (isDaylight ? 'opacity-55 hover:opacity-100' : 'opacity-50 hover:opacity-100')}`}
                    style={active ? { color: accentColor } : undefined}
                >
                    {option.label}
                </Button>
            );
        })}
    </div>
);

const SleepTimerRow: React.FC<SleepTimerRowProps> = ({ theme, isDaylight }) => {
    const { t } = useTranslation();
    // 逐个取字段而不是整个对象：zustand 的快照用 Object.is 比，返回新字面量会让 React 反复重渲染。
    const mode = useSleepTimerStore(state => state.sleepTimerMode);
    const hours = useSleepTimerStore(state => state.sleepTimerHours);
    const minutes = useSleepTimerStore(state => state.sleepTimerMinutes);
    const clockHour = useSleepTimerStore(state => state.sleepTimerClockHour);
    const clockMinute = useSleepTimerStore(state => state.sleepTimerClockMinute);
    const enabled = useSleepTimerStore(state => state.sleepTimerEnabled);
    const endAction = useSleepTimerStore(state => state.sleepTimerEndAction);
    const deadlineMs = useSleepTimerStore(state => state.sleepTimerDeadlineMs);
    const handleToggleSleepTimer = useSleepTimerStore(state => state.handleToggleSleepTimer);
    const handleSetSleepTimerHours = useSleepTimerStore(state => state.handleSetSleepTimerHours);
    const handleSetSleepTimerTotalMinutes = useSleepTimerStore(state => state.handleSetSleepTimerTotalMinutes);
    const handleSetSleepTimerMode = useSleepTimerStore(state => state.handleSetSleepTimerMode);
    const handleSetSleepTimerClock = useSleepTimerStore(state => state.handleSetSleepTimerClock);
    const handleSetSleepTimerEndAction = useSleepTimerStore(state => state.handleSetSleepTimerEndAction);

    const [expanded, setExpanded] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());

    // 开着的时候每秒刷一次：这一行的标题右侧就是倒计时，收起时也看得见 —— 不刷的话它会停在
    // 展开那一刻的读数上，看着像定时器卡了（其实 App 层那条倒计时还在走）。
    useEffect(() => {
        if (!enabled || deadlineMs === null) {
            return;
        }
        setNowMs(Date.now());
        const ticker = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(ticker);
    }, [deadlineMs, enabled]);

    const plan: SleepTimerPlan = { mode, hours, minutes, clockHour, clockMinute };
    const canQuit = canExitApp();
    // 浏览器里没有退出这条路：存了 quit 也按 pause 办，界面上那一项根本不显示。
    const effectiveEndAction: SleepTimerEndAction = endAction === 'quit' && canQuit ? 'quit' : 'pause';
    const hasPlan = hasSleepTimerDelay(plan);
    const delayMs = hasPlan ? resolveSleepTimerDelayMs(plan, Date.now()) : 0;
    const remainingMs = enabled && deadlineMs !== null ? Math.max(0, deadlineMs - nowMs) : null;

    const summary = enabled && remainingMs !== null
        ? formatSleepTimerRemaining(remainingMs)
        : hasPlan
            ? (mode === 'clock'
                ? t(isSleepTimerTargetTomorrow(plan)
                    ? 'commandPalette.sleepTimerRowSummaryClockTomorrow'
                    : 'commandPalette.sleepTimerRowSummaryClock', isSleepTimerTargetTomorrow(plan) ? 'Tomorrow at {{time}}' : 'Today at {{time}}')
                    .replace('{{time}}', formatSleepTimerClock(plan))
                : mode === 'hours'
                    ? t('commandPalette.sleepTimerRowSummaryHours', '{{count}} 小时后')
                        .replace('{{count}}', String(hours))
                    : t('commandPalette.sleepTimerRowSummaryMinutes', '{{count}} 分钟后')
                        .replace('{{count}}', String(readSleepTimerTotalMinutes(plan))))
            : t('commandPalette.sleepTimerRowUnset', '未设置');

    /*
     * 与下面「播放页透明背景」那一行同一套：平铺的一行、同样的行高与内边距、同一颗开关。
     *
     * 以前这里是一块带底色的「井」（外层 bg-black/20 + rounded-xl），控制页上只有它一个是
     * 这么画的，跟下面的透明背景那行摆在一起像两种东西；开关也是另一颗（DioramaSettingsToggle，
     * 跟着主题走色、尺寸也不一样），跟下面那颗并排完全不像一对。现在两处都跟下面对齐。
     *
     * 整行**不能**照搬成 <label>：那一行是整行点击切换开关，而这一行标题上还有「展开/收起」
     * 的点击，套进 label 会让点展开顺手把开关也拨一下。
     */
    return (
        <div>
            <div className="flex min-h-11 items-center gap-3 px-1 py-1.5">
                <Button
                    onClick={() => setExpanded(prev => !prev)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    aria-expanded={expanded}
                >
                    <Timer
                        size={16}
                        className="shrink-0"
                        style={enabled ? { color: theme.accentColor } : { opacity: 0.4 }}
                    />
                    <span className="shrink-0 text-sm leading-5">{t('commandPalette.sleepTimerRowTitle', '定时关闭')}</span>
                    <span
                        className={`min-w-0 flex-1 truncate text-[10px] tabular-nums ${enabled ? '' : 'opacity-50'}`}
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {summary}
                    </span>
                    <ChevronDown
                        size={14}
                        className={`shrink-0 opacity-40 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden
                    />
                </Button>
                <Toggle
                    checked={enabled}
                    disabled={!hasPlan}
                    label={t('commandPalette.sleepTimerRowTitle', '定时关闭')}
                    onChange={next => {
                        // 还没设时间：把编辑区摊开，而不是让开关看着坏了。
                        if (next && !hasPlan) setExpanded(true);
                        handleToggleSleepTimer(next);
                    }}
                />
            </div>

            {expanded && (
                <div className="mt-2 space-y-2 px-1">
                    <SleepTimerChips
                        accentColor={theme.accentColor}
                        isDaylight={isDaylight}
                        activeId={mode}
                        onSelect={id => handleSetSleepTimerMode(id as SleepTimerMode)}
                        options={[
                            { id: 'minutes', label: t('commandPalette.sleepTimerUnitMinutes', '分钟') },
                            { id: 'hours', label: t('commandPalette.sleepTimerUnitHours', '小时') },
                            { id: 'clock', label: t('commandPalette.sleepTimerUnitClock', '定时') },
                        ]}
                    />

                    {mode === 'clock' ? (
                        <div className="flex items-center gap-1.5">
                            <CalendarClock size={14} className="shrink-0 opacity-40" aria-hidden />
                            <SleepTimerInput
                                isDaylight={isDaylight}
                                label={t('commandPalette.sleepTimerClockHourLabel', '时')}
                                max={23}
                                maxLength={2}
                                value={clockHour}
                                onChange={next => handleSetSleepTimerClock(next, clockMinute)}
                            />
                            <span className="text-xs font-semibold opacity-50">:</span>
                            <SleepTimerInput
                                isDaylight={isDaylight}
                                label={t('commandPalette.sleepTimerClockMinuteLabel', '分')}
                                max={59}
                                maxLength={2}
                                value={clockMinute}
                                onChange={next => handleSetSleepTimerClock(clockHour, next)}
                            />
                            <span className="ml-auto shrink-0 text-[10px] tabular-nums opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {hasPlan ? formatSleepTimerRemaining(delayMs) : '--:--:--'}
                            </span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <SleepTimerInput
                                isDaylight={isDaylight}
                                label={mode === 'hours'
                                    ? t('commandPalette.sleepTimerHoursLabel', '小时')
                                    : t('commandPalette.sleepTimerMinutesLabel', '分钟')}
                                max={mode === 'hours' ? SLEEP_TIMER_HOURS_MAX : SLEEP_TIMER_MINUTES_MAX}
                                maxLength={mode === 'hours' ? 2 : 4}
                                value={mode === 'hours' ? hours : readSleepTimerTotalMinutes(plan)}
                                onChange={next => (mode === 'hours'
                                    ? handleSetSleepTimerHours(next)
                                    : handleSetSleepTimerTotalMinutes(next))}
                            />
                            <span className="shrink-0 text-[10px] font-semibold opacity-50">
                                {mode === 'hours'
                                    ? t('commandPalette.sleepTimerUnitHours', '小时')
                                    : t('commandPalette.sleepTimerUnitMinutes', '分钟')}
                            </span>
                            <span className="ml-auto shrink-0 text-[10px] tabular-nums opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {formatSleepTimerRemaining(delayMs)}
                            </span>
                        </div>
                    )}

                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-[10px] font-semibold opacity-45" style={{ color: 'var(--text-secondary)' }}>
                            {t('commandPalette.sleepTimerEndActionLabel', '结束方式')}
                        </span>
                        <SleepTimerChips
                            accentColor={theme.accentColor}
                            isDaylight={isDaylight}
                            activeId={effectiveEndAction}
                            onSelect={id => handleSetSleepTimerEndAction(id as SleepTimerEndAction)}
                            options={[
                                { id: 'pause', label: t('commandPalette.sleepTimerEndActionPause', '暂停播放') },
                                ...(canQuit ? [{ id: 'quit', label: t('commandPalette.sleepTimerEndActionQuit', '退出应用') }] : []),
                            ]}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default SleepTimerRow;
