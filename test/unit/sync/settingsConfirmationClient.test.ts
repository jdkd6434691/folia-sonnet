import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRemoteSettingsConfirmation, putRemoteSettings } from '../../../src/services/sync/syncClient';

// A 200 response is not confirmation unless it proves this exact payload was accepted.
const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../../../src/services/aiNativeFetch', () => ({ createAiFetch: () => transport.fetch }));
const config = { provider: 'sync-server' as const, enabled: true, workerBaseUrl: 'https://sync.test', authToken: 'synthetic-test-token' };
const record = { schemaVersion: 1, updatedAt: '2026-01-01T00:00:00Z', data: { visualizerMode: 'classic', classicTuning: { speed: 1 } } };
const revision = 'a'.repeat(64);
const reply = (value: unknown) => transport.fetch.mockResolvedValue(new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
afterEach(() => { vi.resetAllMocks(); });

describe('settings confirmation client', () => {
    it('rejects the old blind 200 ACK', async () => {
        reply({ ok: true });
        await expect(putRemoteSettings(config, record, revision)).rejects.toThrow('upgrade the server');
    });
    it('rejects confirmation for different settings', async () => {
        reply({ protocol: 'settings-cas-v1', accepted: true, revision, record: { ...record, data: { visualizerMode: 'other' } } });
        await expect(putRemoteSettings(config, record, revision)).rejects.toThrow('did not confirm');
    });
    it('does not let parsing hide a missing/changed payload field', async () => {
        const extended = { ...record, data: { ...record.data, futureSetting: 'sent' } };
        reply({ protocol: 'settings-cas-v1', accepted: true, revision, record });
        await expect(putRemoteSettings(config, extended, revision)).rejects.toThrow('did not confirm');
    });
    it('rejects an unaccepted response even if its document matches', async () => {
        reply({ protocol: 'settings-cas-v1', revision, record });
        await expect(putRemoteSettings(config, record, revision)).rejects.toThrow('did not confirm');
    });
    it('sends the observed revision and accepts server-owned time for the exact payload', async () => {
        const confirmed = { ...record, updatedAt: '2099-01-01T00:00:00.001Z' };
        reply({ protocol: 'settings-cas-v1', accepted: true, revision, record: confirmed });
        expect((await putRemoteSettings(config, record, null)).record?.updatedAt).toBe(confirmed.updatedAt);
        expect(JSON.parse(transport.fetch.mock.calls[0][1].body)).toEqual({ ...record, expectedRevision: null });
    });
    it('rejects malformed confirmation and does not manufacture an empty baseline', async () => {
        reply({ protocol: 'settings-cas-v1', revision: null, record });
        await expect(getRemoteSettingsConfirmation(config)).rejects.toThrow('upgrade the server');
    });
    it('reads an explicitly empty server as an empty observation', async () => {
        reply({ protocol: 'settings-cas-v1', revision: null, record: null });
        expect(await getRemoteSettingsConfirmation(config)).toEqual({ protocol: 'settings-cas-v1', revision: null, record: null });
    });
});
