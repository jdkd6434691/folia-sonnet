import Database from 'better-sqlite3';
import type { D1Database, D1PreparedStatement } from './app.js';

/*
 * 语句缓存。
 *
 * 原来每次 first/all/run 都重新 `db.prepare()` —— 每条 SQL 每次执行都要重新解析编译。
 * 查询都走这里的缓存后，同一句 SQL 只编译一次；缓存按粗粒度整体清空兜底（路由里的
 * SQL 都是固定写法的字符串，实际条目远到不了上限）。
 */
const MAX_CACHED_STATEMENTS = 512;

export class D1Emulator implements D1Database {
  private db: Database.Database;
  private statements = new Map<string, Database.Statement>();
  private runners = new WeakMap<D1PreparedStatement, () => unknown>();

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    /*
     * WAL + NORMAL：崩溃不丢事务（掉电才可能丢最后一笔），写入不再每笔都 fsync。
     * 其余三项：临时表与排序放内存、页缓存给到 64MB、mmap 只读页直接映射——
     * 10w 行的库最怕的就是每次扫描都从页缓存里被挤出去。
     */
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -65536');
    this.db.pragma('mmap_size = 268435456');
  }

  /** 供定时任务做 `PRAGMA optimize`（更新统计信息），Node 侧独有，Workers 上没有。 */
  optimize(): void {
    try {
      this.db.pragma('optimize');
    } catch {
      // 统计信息更新失败不影响服务。
    }
  }

  private statement(query: string): Database.Statement {
    let stmt = this.statements.get(query);
    if (!stmt) {
      stmt = this.db.prepare(query);
      if (this.statements.size >= MAX_CACHED_STATEMENTS) this.statements.clear();
      this.statements.set(query, stmt);
    }
    return stmt;
  }

  prepare(query: string): D1PreparedStatement {
    const createBoundStatement = (boundValues: unknown[]): D1PreparedStatement => {
      const run = () => {
        this.statement(query).run(...boundValues);
        return {};
      };
      const statement: D1PreparedStatement = {
        bind: (...values: unknown[]) => createBoundStatement(values),
        first: async <T = Record<string, unknown>>() => {
          const result = this.statement(query).get(...boundValues) as T | undefined;
          return result ?? null;
        },
        all: async <T = Record<string, unknown>>() => {
          const results = this.statement(query).all(...boundValues) as T[];
          return { results };
        },
        run: async () => run(),
      };
      this.runners.set(statement, () => {
        const stmt = this.statement(query);
        // D1 batch also returns rows for SELECT / PRAGMA / RETURNING statements.
        if (stmt.reader) return { results: stmt.all(...boundValues) };
        return run();
      });
      return statement;
    };
    return createBoundStatement([]);
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    // Validate ownership before any statement runs, including statements with external side effects.
    const runners = statements.map((statement) => {
      const run = this.runners.get(statement);
      if (!run) throw new Error('D1 batch statement belongs to another database');
      return run;
    });
    // Native SQLite transactions must observe synchronous throws, not rejected run() promises.
    return this.db.transaction(() => runners.map((run) => run()))();
  }
}
