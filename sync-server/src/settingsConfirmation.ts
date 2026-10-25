import type { D1Database } from './app.js';

// Atomic settings confirmation uses the existing row, not a device's wall clock or a schema migration.
type SettingsRow = { value_json: string; updated_at: string };

export const readSettingsRow = (db: D1Database) => db.prepare(
    'SELECT value_json, updated_at FROM settings WHERE key = ?',
).bind('visual').first<SettingsRow>();

export const settingsRevision = async (row: SettingsRow | null): Promise<string | null> => {
    if (!row) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([row.updated_at, row.value_json])));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

export const settingsConfirmation = async (row: SettingsRow | null) => ({
    protocol: 'settings-cas-v1' as const,
    revision: await settingsRevision(row),
    record: row ? JSON.parse(row.value_json) : null,
});

/** RETURNING confirms this statement wrote; a SELECT after a no-op cannot provide that guarantee. */
export const compareAndSetSettings = async (
    db: D1Database,
    observed: SettingsRow | null,
    record: Record<string, unknown>,
) => {
    const previousTime = observed ? Date.parse(observed.updated_at) : 0;
    const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
    const valueJson = JSON.stringify({ schemaVersion: record.schemaVersion, updatedAt, data: record.data });
    if (!observed) {
        return db.prepare(`
            INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO NOTHING RETURNING value_json, updated_at
        `).bind('visual', valueJson, updatedAt).first<SettingsRow>();
    }
    return db.prepare(`
        UPDATE settings SET value_json = ?, updated_at = ?
        WHERE key = ? AND value_json = ? AND updated_at = ?
        RETURNING value_json, updated_at
    `).bind(valueJson, updatedAt, 'visual', observed.value_json, observed.updated_at).first<SettingsRow>();
};
