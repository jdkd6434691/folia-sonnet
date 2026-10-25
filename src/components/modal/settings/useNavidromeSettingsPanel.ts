import { useEffect, useState } from 'react';
import {
    clearNavidromeConfig,
    dismissNavidromeServerPreset,
    getCachedNavidromeServerProfile,
    getNavidromeConfig,
    getNavidromeConfigOrigin,
    hashPassword,
    navidromeApi,
    refreshNavidromeServerProfile,
    saveNavidromeConfig,
    setNavidromeEnabled,
} from '../../../services/navidromeService';
import { fetchNavidromeServerPreset, markNavidromeConfigAsPresetIfMatching, restoreNavidromeServerPreset } from '../../../services/navidromeServerPreset';
import type { NavidromeConfig, NavidromeServerProfile } from '../../../types/navidrome';
import { setNavidromeEnabledState, useLibraryStore } from '../../../stores/useLibraryStore';

// src/components/modal/settings/useNavidromeSettingsPanel.ts
// Navidrome 那一段设置的状态：地址、账号、连接测试、Docker 预置的恢复。
// 从 SettingsModal 拆出来；设置保存在哪、测试怎么发请求，都在这里。

type NavidromeSettingsPanelParams = {
    onToggleNavidrome?: (enabled: boolean) => void;
};

export const useNavidromeSettingsPanel = ({ onToggleNavidrome }: NavidromeSettingsPanelParams) => {
    // Navidrome Settings State
    // One truth: this used to be a second copy kept in step with App.tsx's by hand.
    const navidromeEnabled = useLibraryStore(state => state.navidromeEnabled);
    const [navidromeUrl, setNavidromeUrl] = useState('');
    const [navidromeUsername, setNavidromeUsername] = useState('');
    const [navidromePassword, setNavidromePassword] = useState('');
    const [navidromeTestStatus, setNavidromeTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
    const [navidromeConfigured, setNavidromeConfigured] = useState(false);
    const [navidromeServerProfile, setNavidromeServerProfile] = useState<NavidromeServerProfile | null>(null);
    // Docker 部署预置了凭据时，手动配置可以随时切回预置。
    const [navidromePresetAvailable, setNavidromePresetAvailable] = useState(false);
    const [navidromeUsesPreset, setNavidromeUsesPreset] = useState(false);
    const [navidromeRestoreFailed, setNavidromeRestoreFailed] = useState(false);
    const [navidromeRestoring, setNavidromeRestoring] = useState(false);

    // Load Navidrome config on mount
    useEffect(() => {
        const config = getNavidromeConfig();
        if (config) {
            setNavidromeUrl(config.serverUrl);
            setNavidromeUsername(config.username);
            setNavidromeConfigured(true);
            setNavidromeServerProfile(getCachedNavidromeServerProfile());
            setNavidromeUsesPreset(getNavidromeConfigOrigin() === 'server');
        }

        let cancelled = false;
        void fetchNavidromeServerPreset().then((preset) => {
            if (!cancelled) setNavidromePresetAvailable(Boolean(preset));
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const refreshServerProfile = (config: NavidromeConfig) => {
        void refreshNavidromeServerProfile(config)
            .then(setNavidromeServerProfile)
            .catch((error) => {
                console.warn('[Settings] Failed to refresh Navidrome server profile:', error);
                setNavidromeServerProfile(null);
            });
    };

    // Test Navidrome connection
    const testNavidromeConnection = async () => {
        if (!navidromeUrl || !navidromeUsername || !navidromePassword) {
            setNavidromeTestStatus('failed');
            return;
        }

        setNavidromeTestStatus('testing');
        const config: NavidromeConfig = {
            serverUrl: navidromeUrl.replace(/\/$/, ''), // Remove trailing slash
            username: navidromeUsername,
            passwordHash: hashPassword(navidromePassword)
        };

        const success = await navidromeApi.ping(config);
        if (success) {
            // 先按手动配置立刻存下，不让预置请求挡住保存；填的正好是预置的话，预置返回后再改标。
            saveNavidromeConfig(config);
            setNavidromeConfigured(true);
            setNavidromeUsesPreset(false);
            setNavidromeTestStatus('success');
            refreshServerProfile(config);
            void markNavidromeConfigAsPresetIfMatching(config).then((marked) => {
                if (marked) setNavidromeUsesPreset(true);
            });
        } else {
            setNavidromeTestStatus('failed');
        }
    };

    // Toggle Navidrome enabled
    const handleToggleNavidromeEnabled = (enabled: boolean) => {
        setNavidromeEnabled(enabled);
        setNavidromeEnabledState(enabled);
        if (onToggleNavidrome) {
            onToggleNavidrome(enabled);
        }
    };

    // Clear Navidrome config
    const handleClearNavidrome = () => {
        clearNavidromeConfig();
        dismissNavidromeServerPreset();
        setNavidromeUrl('');
        setNavidromeUsername('');
        setNavidromePassword('');
        setNavidromeConfigured(false);
        setNavidromeUsesPreset(false);
        setNavidromeServerProfile(null);
        setNavidromeTestStatus('idle');
    };

    // Drop the manual config and go back to the Docker preset
    const handleRestoreNavidromePreset = async () => {
        if (navidromeRestoring) return;
        setNavidromeRestoreFailed(false);
        setNavidromeRestoring(true);
        const config = await restoreNavidromeServerPreset().finally(() => setNavidromeRestoring(false));
        if (!config) {
            setNavidromeRestoreFailed(true);
            return;
        }
        setNavidromeUrl(config.serverUrl);
        setNavidromeUsername(config.username);
        setNavidromePassword('');
        setNavidromeConfigured(true);
        setNavidromeUsesPreset(true);
        setNavidromeTestStatus('idle');
        setNavidromeServerProfile(getCachedNavidromeServerProfile());
        refreshServerProfile(config);
    };

    return {
        navidromeEnabled,
        navidromeUrl,
        setNavidromeUrl,
        navidromeUsername,
        setNavidromeUsername,
        navidromePassword,
        setNavidromePassword,
        navidromeTestStatus,
        navidromeConfigured,
        navidromeServerProfile,
        navidromeUsesPreset,
        navidromeCanRestorePreset: navidromePresetAvailable && !navidromeUsesPreset,
        navidromeRestoreFailed,
        navidromeRestoring,
        testNavidromeConnection,
        onToggleNavidrome: handleToggleNavidromeEnabled,
        onClearNavidrome: handleClearNavidrome,
        onRestoreNavidromePreset: handleRestoreNavidromePreset,
    };
};

export type NavidromeSettingsPanel = ReturnType<typeof useNavidromeSettingsPanel>;
