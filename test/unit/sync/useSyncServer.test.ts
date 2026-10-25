// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncServer } from '../../../src/components/modal/settings/pages/integration/useSyncServer';
import type { SyncProviderConfig } from '../../../src/services/sync/syncTypes';

// Mounts the real integration hook: the visible draft must be the destination used by import.
const state = vi.hoisted(() => ({
    config: { provider: 'sync-server', enabled: true, workerBaseUrl: 'https://saved-a.test', authToken: 'synthetic-a' } as SyncProviderConfig,
    subscribers: [] as Array<() => void>,
    importedTo: [] as string[],
    sync: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../src/services/sync/syncArchive', () => ({ createSyncLibraryZipBlob: vi.fn(), readSyncLibraryZipFile: vi.fn() }));
vi.mock('../../../src/services/sync/syncConfig', () => ({
    getSyncConfig: () => state.config,
    saveSyncConfig: (config: SyncProviderConfig) => { state.config = config; state.subscribers.forEach(listener => listener()); },
    getSyncStatus: () => ({ state: 'idle', lastSyncAt: null, lastError: null }),
    setSyncStatus: vi.fn(),
    subscribeSyncConfig: (listener: () => void) => { state.subscribers.push(listener); return () => { state.subscribers = state.subscribers.filter(item => item !== listener); }; },
    subscribeSyncStatus: () => () => {},
}));
vi.mock('../../../src/services/sync/syncCoordinator', () => ({
    exportSyncLibraryBundle: vi.fn(),
    importSyncLibraryBundle: async (_bundle: unknown, options: { pushRemote: boolean }) => { if (options.pushRemote) state.importedTo.push(state.config.workerBaseUrl); },
    isSyncLibraryExportBundle: () => true,
    syncNow: (...args: unknown[]) => state.sync(...args),
    testSyncProviderConnection: vi.fn(),
}));
let root: Root;
let hook: ReturnType<typeof useSyncServer>;
const Probe = () => { hook = useSyncServer(); return null; };
beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.config = { provider: 'sync-server', enabled: true, workerBaseUrl: 'https://saved-a.test', authToken: 'synthetic-a' };
    state.subscribers = []; state.importedTo = []; state.sync.mockReset();
    root = createRoot(document.createElement('div'));
    await act(async () => { root.render(React.createElement(Probe)); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

describe('sync server import and conflict destination', () => {
    it('saves the visible dirty draft before importing instead of pushing to the old saved server', async () => {
        await act(async () => { hook.update({ workerBaseUrl: 'https://draft-b.test', authToken: 'synthetic-b' }); });
        await act(async () => { await hook.readImportFile({ name: 'library.json', text: async () => '{}' } as File); });
        await act(async () => { await hook.confirmImport(); });
        expect(state.importedTo).toEqual(['https://draft-b.test']);
        expect(state.config.authToken).toBe('synthetic-b');
    });
    it('clears a pending conflict when destination credentials are edited', async () => {
        state.sync.mockResolvedValue({ settingsConflict: true, settingsRevision: 'a'.repeat(64), settingsScope: 'b'.repeat(64) });
        await act(async () => { await hook.syncSettings(); });
        expect(hook.hasSettingsConflict).toBe(true);
        await act(async () => { hook.update({ authToken: 'different-synthetic-token' }); });
        expect(hook.hasSettingsConflict).toBe(false);
    });
});
