import React from 'react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../shared/ThemedDialog';
import AndroidUpdatePanel from './settings/AndroidUpdatePanel';
import { Button } from '@/components/ui';

// src/components/modal/AppUpdatePromptDialog.tsx
// 启动时发现新版本的提示。
//
// 弹窗里不再另写一套按钮 —— 直接复用设置页那块更新卡片（AndroidUpdatePanel）：
// 检查、下载、进度、安装、发布页、更新内容在两处长得一模一样，也共用同一份下载状态。
// 弹窗只多两件事：新版本的标题，和「忽略此版本」。

type AppUpdatePromptDialogProps = {
    isOpen: boolean;
    isDaylight: boolean;
    onClose: () => void;
    onIgnoreVersion: () => void;
};

const AppUpdatePromptDialog: React.FC<AppUpdatePromptDialogProps> = ({
    isOpen,
    isDaylight,
    onClose,
    onIgnoreVersion,
}) => {
    const { t } = useTranslation();
    const ghostClass = `rounded-xl px-3 py-2 text-sm transition-colors ${
        isDaylight ? 'text-zinc-600 hover:bg-zinc-200/60' : 'text-zinc-300 hover:bg-white/10'
    }`;

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={t('options.androidUpdatePromptTitle')}
            description={t('options.androidUpdatePromptDescription')}
            size="s"
            panelKind="app-update"
            footer={(
                <>
                    <Button onClick={onIgnoreVersion} className={ghostClass}>
                        {t('options.androidUpdateIgnoreVersion')}
                    </Button>
                    <Button onClick={onClose} className={ghostClass}>
                        {t('options.androidUpdateLater')}
                    </Button>
                </>
            )}
        >
            <AndroidUpdatePanel widthClassName="w-full" />
        </ThemedDialog>
    );
};

export default AppUpdatePromptDialog;
