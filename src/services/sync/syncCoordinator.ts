import { getSyncConfig, isSyncConfigured, setSyncStatus } from './syncConfig';
import { getRemoteState, SyncClientError, testSyncConnection } from './syncClient';
import type { SyncProviderConfig } from './syncTypes';
import { applySyncedVisualSettings, buildSyncedSettingsRecord, getSyncedSettingsSignature, readSyncableSettingsState } from './settingsSnapshot';
import {
    fetchRemoteSyncState,
    fetchRemoteSettingsConfirmation,
    listAllRemoteThemeRecords,
    mergeLocalThemesIntoRecords,
    pushMissingLocalThemesToRemote,
    pushRemoteSettings,
    pushSyncLibraryBundleToRemote,
    saveSyncLibraryBundleToLocalCache,
} from './syncRepository';
import { parseSyncLibraryExportBundle } from './syncSchema';
import type { SettingsConfirmation, SyncLibraryExportBundle } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';
import { getStoredString, removeStoredKey, setStoredString } from '../../stores/storagePrimitives';
import { sha256Hex } from '../../utils/sha256';

// src/services/sync/syncCoordinator.ts
// Coordinates startup theme sync and user-triggered manual sync commands.

const LOCAL_SETTINGS_UPDATED_AT_KEY = 'folia_sync_local_settings_updated_at_v1';
const SETTINGS_BASELINE_KEY = 'folia_sync_settings_confirmation_v1';
let isSyncingInProgress = false;

type SettingsBaseline = { scope: string; revision: string; signature: string };
const settingsConfigIdentity = () => {
    const config = getSyncConfig();
    return JSON.stringify([config.enabled, config.workerBaseUrl.trim().replace(/\/+$/, ''), config.authToken]);
};
const settingsScope = (identity: string) => sha256Hex(identity);
const assertSettingsConfig = (identity: string) => {
    if (settingsConfigIdentity() !== identity) throw new Error('Sync server changed during settings sync');
};
const getBaseline = (scope: string): SettingsBaseline | null => {
    try {
        const value = JSON.parse(getStoredString(SETTINGS_BASELINE_KEY, 'null')) as SettingsBaseline | null;
        return value?.scope === scope && typeof value.revision === 'string' && typeof value.signature === 'string' ? value : null;
    } catch {
        return null;
    }
};

/** Save only the confirmed snapshot, so edits made while a request was pending remain dirty. */
const markSettingsInSync = (confirmed: SettingsConfirmation, signature: string, scope: string, identity: string) => {
    assertSettingsConfig(identity);
    if (!confirmed.record || !confirmed.revision) throw new Error('Missing settings confirmation');
    setStoredString(LOCAL_SETTINGS_UPDATED_AT_KEY, confirmed.record.updatedAt);
    setStoredString(SETTINGS_BASELINE_KEY, JSON.stringify({ scope, revision: confirmed.revision, signature }));
};

const pushCurrentSettings = async (observed: SettingsConfirmation, scope: string, identity: string) => {
    assertSettingsConfig(identity);
    // Detach nested settings from mutable stores before starting IO.
    const state = readSyncableSettingsState();
    const signature = getSyncedSettingsSignature(state);
    const record = JSON.parse(JSON.stringify(buildSyncedSettingsRecord(state))) as ReturnType<typeof buildSyncedSettingsRecord>;
    const confirmed = await pushRemoteSettings(record, observed.revision);
    markSettingsInSync(confirmed, signature, scope, identity);
    return true;
};

export const initializeSyncCoordinator = () => {
    void syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false });
    return () => {};
};

export const testSyncProviderConnection = async (config: SyncProviderConfig) => {
    const response = await testSyncConnection(config);
    if (!response.ok) return false;
    return Boolean(await getRemoteState(config));
};

const applyRemoteSettingsRecord = (confirmed: SettingsConfirmation, scope: string, identity: string) => {
    if (!confirmed.record) return;
    assertSettingsConfig(identity);
    applySyncedVisualSettings(readSyncableSettingsState(), confirmed.record.data);
    markSettingsInSync(confirmed, getSyncedSettingsSignature(readSyncableSettingsState()), scope, identity);
};

/** Both sides changed: pause unless the person explicitly chooses which side to keep. */
export type SettingsConflictResolution = 'local' | 'remote';
type SettingsSyncOutcome = {
    appliedRemoteSettings: boolean;
    pushedLocalSettings: boolean;
    settingsConflict: boolean;
    settingsRevision: string | null;
    settingsScope: string | null;
};

const syncVisualSettings = async (
    options: { applyRemote: boolean; push: boolean; resolution?: SettingsConflictResolution; expectedRevision?: string | null; expectedScope?: string | null; identity: string; initialSignature: string },
): Promise<SettingsSyncOutcome> => {
    const outcome: SettingsSyncOutcome = { appliedRemoteSettings: false, pushedLocalSettings: false, settingsConflict: false, settingsRevision: null, settingsScope: null };
    // Always read the actual row/revision; timestamps in /state can miss same-clock legacy writes.
    const identity = options.identity;
    assertSettingsConfig(identity);
    const scope = await settingsScope(identity);
    assertSettingsConfig(identity);
    const initialSignature = options.initialSignature;
    const observed = await fetchRemoteSettingsConfirmation();
    assertSettingsConfig(identity);
    outcome.settingsRevision = observed.revision;
    outcome.settingsScope = scope;
    if (options.resolution && options.expectedScope !== undefined && options.expectedScope !== scope) {
        outcome.settingsConflict = true;
        return outcome;
    }
    if (options.resolution && options.expectedRevision !== undefined && options.expectedRevision !== observed.revision) {
        outcome.settingsConflict = true;
        return outcome;
    }
    if (options.resolution === 'remote' && !observed.record) {
        outcome.settingsConflict = true;
        return outcome;
    }
    const baseline = getBaseline(scope);
    const localChanged = !baseline || baseline.signature !== getSyncedSettingsSignature(readSyncableSettingsState());
    const remoteChanged = Boolean(observed.record) && (!baseline || baseline.revision !== observed.revision);
    if (observed.record && options.applyRemote && options.resolution !== 'local'
        && initialSignature !== getSyncedSettingsSignature(readSyncableSettingsState())) {
        outcome.settingsConflict = true;
        return outcome;
    }
    if (options.resolution === 'remote' && observed.record && options.applyRemote) {
        applyRemoteSettingsRecord(observed, scope, identity);
        outcome.appliedRemoteSettings = true;
        return outcome;
    }
    if (remoteChanged && localChanged && !options.resolution) {
        outcome.settingsConflict = true;
        return outcome;
    }
    if (remoteChanged && options.resolution !== 'local') {
        if (options.applyRemote) {
            applyRemoteSettingsRecord(observed, scope, identity);
            outcome.appliedRemoteSettings = true;
        } else {
            outcome.settingsConflict = true;
        }
        return outcome;
    }
    if (options.push && (options.resolution === 'local' || localChanged || !observed.record)) {
        try {
            outcome.pushedLocalSettings = await pushCurrentSettings(observed, scope, identity);
        } catch (error) {
            if (!(error instanceof SyncClientError) || error.status !== 409) throw error;
            // Do not retry over a version the person never observed, or advance the baseline.
            outcome.settingsConflict = true;
            assertSettingsConfig(identity);
            outcome.settingsRevision = (await fetchRemoteSettingsConfirmation()).revision;
            assertSettingsConfig(identity);
        }
    }
    return outcome;
};

export const pullRemoteVisualSettings = async () => {
    if (!isSyncConfigured()) return false;
    const result = await syncNow({ syncThemes: false, applyRemoteSettings: true, pushSettings: false });
    return result?.appliedRemoteSettings ?? false;
};

export type SyncNowResult = {
    uploadedThemeCount: number;
    downloadedThemeCount: number;
    checkedLocalThemeCount: number;
    diffBucketCount: number;
    skippedRemoteThemeScan: boolean;
    appliedRemoteSettings: boolean;
    pushedLocalSettings: boolean;
    settingsConflict: boolean;
    settingsRevision: string | null;
    settingsScope: string | null;
};

export const syncNow = async (options: {
    syncThemes?: boolean;
    applyRemoteSettings?: boolean;
    pushSettings?: boolean;
    settingsConflictResolution?: SettingsConflictResolution;
    settingsConflictRevision?: string | null;
    settingsConflictScope?: string | null;
} = {}): Promise<SyncNowResult | null> => {
    if (isSyncingInProgress || !isSyncConfigured(getSyncConfig())) return null;
    isSyncingInProgress = true;
    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        const identity = settingsConfigIdentity();
        const initialSignature = getSyncedSettingsSignature(readSyncableSettingsState());
        const remoteState = await fetchRemoteSyncState();
        assertSettingsConfig(identity);
        let themeSyncResult = {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: 0,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
        if (options.syncThemes ?? true) {
            themeSyncResult = await pushMissingLocalThemesToRemote(remoteState);
        }
        const settingsOutcome = (options.applyRemoteSettings || options.pushSettings)
            ? await syncVisualSettings({
                identity,
                initialSignature,
                applyRemote: Boolean(options.applyRemoteSettings),
                push: Boolean(options.pushSettings),
                resolution: options.settingsConflictResolution,
                expectedRevision: options.settingsConflictRevision,
                expectedScope: options.settingsConflictScope,
            })
            : { appliedRemoteSettings: false, pushedLocalSettings: false, settingsConflict: false, settingsRevision: null, settingsScope: null };
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
        const summary = {
            uploadedThemeCount: themeSyncResult.uploadedCount,
            downloadedThemeCount: themeSyncResult.downloadedCount,
            checkedLocalThemeCount: themeSyncResult.checkedLocalThemeCount,
            diffBucketCount: themeSyncResult.diffBucketCount,
            skippedRemoteThemeScan: themeSyncResult.skippedRemoteThemeScan,
            ...settingsOutcome,
        };
        console.info('[sync] Sync completed', summary);
        if (summary.downloadedThemeCount > 0 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('folia-themes-synced'));
        }
        return summary;
    } catch (error) {
        console.error('[sync] Sync failed:', error);
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        return null;
    } finally {
        isSyncingInProgress = false;
    }
};

export const exportSyncLibraryBundle = async (): Promise<SyncLibraryExportBundle> => {
    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        const settings = buildSyncedSettingsRecord(readSyncableSettingsState(), new Date().toISOString());
        const themes = await mergeLocalThemesIntoRecords(await listAllRemoteThemeRecords());
        const bundle: SyncLibraryExportBundle = {
            kind: 'folia-sync-export',
            schemaVersion: SYNC_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            settings,
            themes,
        };
        setSyncStatus({ state: 'success', lastSyncAt: bundle.exportedAt, lastError: null });
        console.info('[sync] Export completed', { themeCount: bundle.themes.length });
        return bundle;
    } catch (error) {
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        throw error;
    }
};

export const isSyncLibraryExportBundle = (value: unknown): value is SyncLibraryExportBundle => (
    parseSyncLibraryExportBundle(value) !== null
);

export const importSyncLibraryBundle = async (bundle: unknown, options: { pushRemote?: boolean } = {}) => {
    const validatedBundle = parseSyncLibraryExportBundle(bundle);
    if (!validatedBundle) throw new Error('Invalid Folia sync export');
    if (isSyncingInProgress) throw new Error('Sync is already in progress');
    const identity = settingsConfigIdentity();
    isSyncingInProgress = true;
    setSyncStatus({ state: 'syncing', lastError: null });
    try {
        await saveSyncLibraryBundleToLocalCache(validatedBundle);
        assertSettingsConfig(identity);
        if (validatedBundle.settings) {
            // Import is a local edit, never evidence of agreement with the server, even if its date is newer.
            removeStoredKey(SETTINGS_BASELINE_KEY);
            applySyncedVisualSettings(readSyncableSettingsState(), validatedBundle.settings.data);
        }
        if (options.pushRemote ?? true) {
            // Use the complete resulting local snapshot (imports may contain only a subset of settings).
            // Keep it dirty until themes and the CAS write both succeed.
            const scope = await settingsScope(identity);
            assertSettingsConfig(identity);
            const observed = validatedBundle.settings ? await fetchRemoteSettingsConfirmation() : null;
            assertSettingsConfig(identity);
            const state = readSyncableSettingsState();
            const signature = getSyncedSettingsSignature(state);
            const record = JSON.parse(JSON.stringify(buildSyncedSettingsRecord(state))) as ReturnType<typeof buildSyncedSettingsRecord>;
            await pushSyncLibraryBundleToRemote({ ...validatedBundle, settings: null });
            assertSettingsConfig(identity);
            if (observed) {
                assertSettingsConfig(identity);
                const confirmed = await pushRemoteSettings(record, observed.revision);
                markSettingsInSync(confirmed, signature, scope, identity);
            }
        }
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
        console.info('[sync] Import completed', {
            pushedRemote: options.pushRemote ?? true,
            themeCount: validatedBundle.themes.length,
            appliedSettings: Boolean(validatedBundle.settings),
        });
        return true;
    } catch (error) {
        setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        throw error;
    } finally {
        isSyncingInProgress = false;
    }
};
