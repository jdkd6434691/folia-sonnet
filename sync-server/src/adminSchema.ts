import type { D1Database } from './app.js';

// Additive admin-session migration: old cookies remain stored but cannot authenticate without a tag.
export const ensureAdminSessionSchema = async (db: D1Database): Promise<void> => {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            credential_tag TEXT
        )
    `).run();
    const columns = await db.prepare('PRAGMA table_info(admin_sessions)').all<{ name: string }>();
    if (columns.results?.some((column) => column.name === 'credential_tag')) return;
    try {
        await db.prepare('ALTER TABLE admin_sessions ADD COLUMN credential_tag TEXT').run();
    } catch (error) {
        // A second Worker isolate may have added the column after our PRAGMA.
        const after = await db.prepare('PRAGMA table_info(admin_sessions)').all<{ name: string }>();
        if (!after.results?.some((column) => column.name === 'credential_tag')) throw error;
    }
};
