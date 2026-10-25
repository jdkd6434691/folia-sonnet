import { serve } from '@hono/node-server';
import { D1Emulator } from './d1-emulator.js';
import app from './app.js';
import { readAdminCredentials } from './admin.js';
import { pruneHitLog } from './aiCache.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createNodeFontBlobStore } from './fontBlobs.node.js';
import { createD1FontBlobStore } from './fontBlobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to load basic .env file if it exists
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
} catch (e) {
  // Ignore
}

const SYNC_TOKEN = process.env.SYNC_TOKEN;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
// Missing credentials disable the panel without disabling public/sync routes.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PUBLIC_ORIGIN = process.env.ADMIN_PUBLIC_ORIGIN;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../folia-sync.db');
// 字体字节默认挨着数据库文件放：整机迁移时只要带着这一个目录，两边都不会散。
const FONT_DIR = process.env.FONT_DIR || path.resolve(path.dirname(DB_PATH), 'font-files');

if (!SYNC_TOKEN) {
  console.error('\x1b[31m[ERROR]\x1b[0m SYNC_TOKEN environment variable is missing.');
  console.error('Please set it via .env file or environment variable.');
  process.exit(1);
}

if (SYNC_TOKEN.length < 8) {
  console.error('\x1b[31m[ERROR]\x1b[0m SYNC_TOKEN is too weak. Must be at least 8 characters long.');
  process.exit(1);
}

const db = new D1Emulator(DB_PATH);
/* 落到文件；老数据还在数据库里，读的时候会自己回退（见 fontBlobs.node.ts）。 */
const fontBlobs = createNodeFontBlobStore(FONT_DIR, createD1FontBlobStore(db));

/*
 * 命中流水（ai_cache_hits）只留七天，但清理原来只挂在「前台看统计图」那条路上 ——
 * 没人看图，流水就一直长。这里每小时清一次，顺手做一次 `PRAGMA optimize`
 * （更新查询计划用的统计信息）。Workers 部署没有定时器，继续靠统计图那条路兜底。
 */
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
let maintenanceRunning = false;
setInterval(() => {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  Promise.all([
    pruneHitLog(db),
    Promise.resolve(db.optimize()),
  ])
    .catch(() => undefined)
    .finally(() => {
      maintenanceRunning = false;
    });
}, MAINTENANCE_INTERVAL_MS).unref();

const logo = `
\x1b[35m  _____    _ _          \x1b[36m ____                  \x1b[0m
\x1b[35m |  ___|__| (_) __ _    \x1b[36m/ ___| _   _ _ __   ___ \x1b[0m
\x1b[35m | |_ / _ \\ | |/ _\` |   \x1b[36m\\___ \\| | | | '_ \\ / __|\x1b[0m
\x1b[35m |  _| (_) | | | (_| |  \x1b[36m ___) | |_| | | | | (__ \x1b[0m
\x1b[35m |_|  \\___/|_|_|\\__,_|  \x1b[36m|____/ \\__, |_| |_|\\___|\x1b[0m
\x1b[36m                               |___/            \x1b[0m
`;

let version = 'unknown';
try {
  const pkgPath = path.resolve(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  version = pkg.version;
} catch (e) {
  // Ignore
}

console.log(logo);
console.log(`\x1b[32m[Folia Sync Server]\x1b[0m Starting Node.js standalone server (v${version})...`);
console.log(`- Port: \x1b[33m${PORT}\x1b[0m`);
console.log(`- Database: \x1b[33m${DB_PATH}\x1b[0m`);
console.log(`- Font files: \x1b[33m${FONT_DIR}\x1b[0m`);
if (DASHBOARD_TOKEN) {
  console.log(`- Dashboard: \x1b[36mhttp://localhost:${PORT}/?token=${DASHBOARD_TOKEN}\x1b[0m`);
} else {
  console.log(`- Dashboard: Disabled (DASHBOARD_TOKEN not set)`);
}
const adminCredentials = readAdminCredentials({ ADMIN_USERNAME, ADMIN_PASSWORD });
if (adminCredentials) {
  console.log(`- Admin panel: \x1b[36mhttp://localhost:${PORT}/admin\x1b[0m (${adminCredentials.username})`);
} else {
  console.warn('[admin] Panel disabled: set ADMIN_USERNAME and ADMIN_PASSWORD (at least 16 non-padding characters).');
}

serve({
  fetch: (req) => app.fetch(req, {
    FOLIA_SYNC_DB: db,
    SYNC_TOKEN,
    DASHBOARD_TOKEN,
    ADMIN_USERNAME,
    ADMIN_PASSWORD,
    ADMIN_PUBLIC_ORIGIN,
    FONT_BLOBS: fontBlobs,
    readDatabaseBytes: () => {
      try {
        return fs.statSync(DB_PATH).size;
      } catch {
        return null;
      }
    },
  }),
  port: PORT,
});
