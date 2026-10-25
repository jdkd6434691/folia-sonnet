import React, { useEffect, useState } from 'react';
import { Check, Copy, ShieldCheck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../shared/ThemedDialog';
import { QQ_COMMUNITY_GROUP_NUMBER } from '../shared/qqCommunity';
import { copyText } from '../../utils/system/clipboard';
import { Button } from '@/components/ui';

// src/components/modal/FreeSoftwareNoticeModal.tsx
// 首次启动的免费软件声明。
//
// 为什么会有一个弹窗：Folia 是免费的，但它是从第三方渠道流出去的，有人拿它卖钱。装好第一次
// 打开时把这件事说清楚，比让人在别处看到「付费版」再来问便宜得多。
//
// 只弹一次（按安装计，不按版本）：写 localStorage 标记，见 useStartupExperienceGate。
// 它不是「同意才能用」的协议 —— 右上角关闭和「我知道了」都只是记账，不拦人。

const COPIED_FEEDBACK_MS = 1800;

type FreeSoftwareNoticeModalProps = {
    isOpen: boolean;
    isDaylight: boolean;
    onClose: () => void;
};

const FreeSoftwareNoticeModal: React.FC<FreeSoftwareNoticeModalProps> = ({ isOpen, isDaylight, onClose }) => {
    const { t } = useTranslation();
    const [groupCopied, setGroupCopied] = useState(false);

    useEffect(() => {
        if (!groupCopied) return undefined;
        const timer = window.setTimeout(() => setGroupCopied(false), COPIED_FEEDBACK_MS);
        return () => window.clearTimeout(timer);
    }, [groupCopied]);

    // QQ 群没有能直接打开的入群链接，与设置 → 帮助里那个入口同一套做法：复制群号。
    const copyGroupNumber = async () => {
        try {
            await copyText(QQ_COMMUNITY_GROUP_NUMBER);
            setGroupCopied(true);
        } catch (error) {
            console.error('Failed to copy the QQ group number:', error);
            setGroupCopied(false);
        }
    };

    const primaryBtnClass = isDaylight
        ? 'bg-zinc-900 text-white hover:bg-zinc-700'
        : 'bg-white text-zinc-950 hover:bg-zinc-200';
    const secondaryBtnClass = isDaylight
        ? 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
        : 'border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white';
    const panelBg = isDaylight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/[0.04] border-white/10';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={t('freeSoftwareNotice.title', 'Folia 是免费软件')}
            size="m"
        >
            <div className={`space-y-3 text-sm leading-6 ${textSecondary}`}>
                <p>{t('freeSoftwareNotice.freeForever', 'Folia 完全免费，所有功能对所有人开放。')}</p>
                <p>
                    {t('freeSoftwareNotice.noPaidTier', '官方没有付费会员、激活码或「解锁版」，也永远不会向您收取任何费用。')}
                </p>
                <p>
                    {t('freeSoftwareNotice.paidIsScam', '如果您是从第三方渠道付费获得的，那不是官方行为，请尽快申请退款。')}
                </p>
            </div>

            <Button
                onClick={() => void copyGroupNumber()}
                className={`mt-5 flex w-full items-center gap-3 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 ${panelBg}`}
            >
                <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isDaylight ? 'bg-white' : 'bg-white/10'
                    }`}
                >
                    {groupCopied
                        ? <Check size={19} className="text-emerald-500" />
                        : <Users size={19} className={textSecondary} />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {t('freeSoftwareNotice.joinGroup', '加入官方 QQ 群')}
                    </span>
                    <span className={`mt-1 block text-xs leading-5 ${textSecondary}`}>
                        {groupCopied
                            ? t('freeSoftwareNotice.groupCopied', '群号已复制')
                            : t('freeSoftwareNotice.joinGroupHint', '官方 QQ 群 {{number}} · 点击复制群号', { number: QQ_COMMUNITY_GROUP_NUMBER })}
                    </span>
                </span>
                <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${textSecondary}`}>
                    {groupCopied ? <Check size={14} /> : <Copy size={14} />}
                </span>
            </Button>

            <p className={`mt-4 flex items-start gap-2 text-xs leading-5 ${textSecondary}`}>
                <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
                {t('freeSoftwareNotice.officialChannels', '软件内与官方 QQ 群是我们唯一发布消息的地方。')}
            </p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                    onClick={onClose}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${secondaryBtnClass}`}
                >
                    {t('ui.close', '关闭')}
                </Button>
                <Button
                    onClick={onClose}
                    className={`rounded-full px-5 py-2 text-sm font-semibold transition ${primaryBtnClass}`}
                >
                    {t('freeSoftwareNotice.acknowledge', '我知道了')}
                </Button>
            </div>
        </ThemedDialog>
    );
};

export default FreeSoftwareNoticeModal;
