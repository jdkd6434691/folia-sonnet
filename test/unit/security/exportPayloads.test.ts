import { describe, expect, it, vi } from 'vitest';
import { buildCurrentConfig, type ConfigThemeControls } from '@/components/modal/settings/pages/storage/visualConfigTransfer';
import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';
import { buildSyncedVisualSettings, readSyncableSettingsState } from '@/services/sync/settingsSnapshot';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';

// test/unit/security/exportPayloads.test.ts
// 同步与导出带走的是外观设置，不是凭据：同步文档存在同步服务器和自己的设备上，外观配置会被编码进
// 别人点开的配置码和 OBS 链接。这里断言的是结构（有没有名字像凭据的字段），不是字段清单——
// 加一个外观设置不该改这里。

const SENTINEL = 'sk-sentinel-should-never-travel-0123456789';
// 只认真正像凭据的键名；keywordColoringEnabled 这类含 key 的外观设置不算。
const CREDENTIAL_FIELD = /(?:api[_-]?key|token|secret|password|passwd|credential|cookie|authorization)/i;

/** 递归找出 payload 里所有名字像凭据的字段路径。 */
const credentialPaths = (value: unknown, at = '$'): string[] => {
    if (Array.isArray(value)) return value.flatMap((item, index) => credentialPaths(item, at + '[' + index + ']'));
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => [
        ...(CREDENTIAL_FIELD.test(key) ? [at + '.' + key] : []),
        ...credentialPaths(inner, at + '.' + key),
    ]);
};

const controls = (over: Partial<ConfigThemeControls> = {}): ConfigThemeControls => ({
    bgMode: 'default',
    aiTheme: null,
    customTheme: null,
    isCustomThemePreferred: false,
    songThemeAutoSwitchEnabled: true,
    songThemeAutoGenerateEnabled: false,
    onSaveCustomTheme: vi.fn(),
    onApplyCustomTheme: vi.fn(),
    onToggleSongThemeAutoSwitch: vi.fn(),
    onToggleSongThemeAutoGenerate: vi.fn(),
    onChangeThemeGenerationSource: vi.fn(),
    ...over,
});

describe('同步的视觉设置', () => {
    it('只带外观字段，设置状态里将来多出来的凭据也不带', () => {
        const state = {
            ...readSyncableSettingsState(),
            authToken: SENTINEL,
            geminiApiKey: SENTINEL,
            syncConfig: { workerBaseUrl: 'https://sync.example.com', authToken: SENTINEL },
        };

        const document = buildSyncedVisualSettings(state);

        expect(credentialPaths(document)).toEqual([]);
        expect(JSON.stringify(document)).not.toContain(SENTINEL);
    });
});

describe('外观配置编码', () => {
    it('编码只认外观字段，塞进配置对象里的凭据不会进短码', () => {
        const code = compressConfig({ ...buildVisualSettingsConfig(), apiKey: SENTINEL, authToken: SENTINEL });

        expect(code).not.toContain(SENTINEL);
        expect(credentialPaths(decompressConfig(code))).toEqual([]);
    });
});

describe('外观配置导出', () => {
    it('导出结果与它编出来的短码里都没有凭据字段', () => {
        const config = buildCurrentConfig(controls(), 'custom');

        expect(credentialPaths(config)).toEqual([]);
        expect(JSON.stringify(config)).not.toContain(SENTINEL);
        expect(credentialPaths(decompressConfig(compressConfig(config)))).toEqual([]);
    });
});
