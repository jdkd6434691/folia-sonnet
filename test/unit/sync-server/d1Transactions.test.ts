import { afterEach, describe, expect, it } from 'vitest';
import { D1Emulator } from '../../../sync-server/src/d1-emulator';
import type { D1PreparedStatement } from '../../../sync-server/src/app';

// Real SQLite regression tests; every database is private and in memory.
const databases: D1Emulator[] = [];
const database = async () => {
    const db = new D1Emulator(':memory:');
    databases.push(db);
    await db.prepare('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)').run();
    return db;
};
afterEach(() => {
    for (const db of databases.splice(0)) (db as unknown as { db: { close(): void } }).db.close();
});

describe('Node D1 synchronous transactions', () => {
    it('rejects a second-statement SQL failure and rolls back the first write', async () => {
        const db = await database();
        await expect(db.batch([
            db.prepare('INSERT INTO records VALUES (?, ?)').bind(1, 'first'),
            db.prepare('INSERT INTO missing VALUES (2)'),
        ])).rejects.toThrow(/missing/);
        expect((await db.prepare('SELECT * FROM records').all()).results).toEqual([]);
    });

    it('rolls back a second-statement constraint failure', async () => {
        const db = await database();
        await expect(db.batch([
            db.prepare('INSERT INTO records VALUES (1, \'first\')'),
            db.prepare('INSERT INTO records VALUES (1, \'duplicate\')'),
        ])).rejects.toThrow(/UNIQUE/);
        expect((await db.prepare('SELECT * FROM records').all()).results).toEqual([]);
    });

    it('rejects a foreign DB statement before either DB is changed', async () => {
        const local = await database();
        const foreign = await database();
        await expect(local.batch([
            local.prepare('INSERT INTO records VALUES (1, \'local\')'),
            foreign.prepare('INSERT INTO records VALUES (2, \'foreign\')').bind(),
        ])).rejects.toThrow(/another database/);
        expect((await local.prepare('SELECT * FROM records').all()).results).toEqual([]);
        expect((await foreign.prepare('SELECT * FROM records').all()).results).toEqual([]);
    });

    it('rejects foreign statements without invoking their public run method', async () => {
        const db = await database();
        let calls = 0;
        const foreign = { run: async () => { calls += 1; } } as D1PreparedStatement;
        await expect(db.batch([foreign])).rejects.toThrow(/another database/);
        expect(calls).toBe(0);
    });

    it('keeps read batches, ordering, PRAGMA and RETURNING results', async () => {
        const db = await database();
        const results = await db.batch([
            db.prepare('INSERT INTO records VALUES (?, ?) RETURNING id, value').bind(1, 'one'),
            db.prepare('SELECT id, value FROM records WHERE id = ?').bind(1),
            db.prepare('PRAGMA table_info(records)'),
        ]) as { results: Record<string, unknown>[] }[];
        expect(results[0].results).toEqual([{ id: 1, value: 'one' }]);
        expect(results[1].results).toEqual(results[0].results);
        expect(results[2].results.map((row) => row.name)).toEqual(['id', 'value']);
    });

    it('preserves public first/all/run, immutable binds and empty batches', async () => {
        const db = await database();
        const insert = db.prepare('INSERT INTO records VALUES (?, ?)');
        const one = insert.bind(1, 'one');
        const two = one.bind(2, 'two');
        expect(await db.batch([one, two])).toEqual([{}, {}]);
        expect(await db.batch([])).toEqual([]);
        expect(await db.prepare('SELECT value FROM records WHERE id = ?').bind(1).first()).toEqual({ value: 'one' });
        expect(await db.prepare('SELECT * FROM records WHERE id = 9').first()).toBeNull();
        expect(await db.prepare('DELETE FROM records WHERE id = 2').run()).toEqual({});
        expect((await db.prepare('SELECT id FROM records').all()).results).toEqual([{ id: 1 }]);
    });
});
