// test/render/renderSession.mjs
// preview.mjs 与 layoutCheck.mjs 共用的页面会话：解析参数、按需拉起 vite dev server、开 chromium、注入初始脚本。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// 5199 不在仓库其他脚本/Playwright 用到的端口（3000 dev、4173 测试）里，避免撞上正在跑的服务。
export const DEFAULT_PORT = 5199;
export const DEFAULT_PAGE = '/dev-probe.html';
export const DEFAULT_WIDTH = 1440;
export const DEFAULT_HEIGHT = 1100;
export const DEFAULT_WAIT_MS = 1200;

// 本机如果配了系统代理，访问回环地址会被拦；Playwright 的配置里也是这么处理的。
process.env.NO_PROXY = process.env.NO_PROXY ? process.env.NO_PROXY + ',127.0.0.1,localhost,::1' : '127.0.0.1,localhost,::1';
process.env.no_proxy = process.env.no_proxy ? process.env.no_proxy + ',127.0.0.1,localhost,::1' : '127.0.0.1,localhost,::1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 只支持 --key value 与 --flag；--no-server 会变成 noServer，省得每个脚本各写一套解析。
export function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error('无法识别的参数：' + token + '（参数都要以 -- 开头，--help 看用法）');
        const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const next = argv[index + 1];
        if (next === undefined || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            index += 1;
        }
    }
    return args;
}

function readNumber(args, key, fallback, label) {
    if (args[key] === undefined) return fallback;
    const value = Number(args[key]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(label + ' 需要正数，收到：' + args[key]);
    return value;
}

function readOptionalPath(args, key) {
    if (typeof args[key] !== 'string') return undefined;
    const resolved = path.resolve(process.cwd(), args[key]);
    if (!fs.existsSync(resolved)) throw new Error('找不到 --' + key + ' 文件：' + resolved);
    return resolved;
}

// Git Bash / MSYS 会把 /dev-probe.html 转成 C:/Program Files/Git/dev-probe.html，
// 这种值不可能是 dev server 的页面路径：从后往前找仓库里真实存在的文件，还原成 /dev-probe.html。
function recoverPagePath(page) {
    if (!/^[A-Za-z]:[\\/]/.test(page)) return page;
    // 单独一个 '/' 被转成了某个真实存在的目录（不同 shell 前缀不同）：原始参数就是根路径。
    if (fs.existsSync(page) && fs.statSync(page).isDirectory()) return '/';
    const segments = page.replace(/\\/g, '/').split('/').filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
        const candidate = segments.slice(index).join('/');
        if (fs.existsSync(path.join(repoRoot, candidate))) return '/' + candidate;
    }
    return '/' + segments[segments.length - 1];
}

export function readOptions(args) {
    for (const [key, label] of [['url', '--url'], ['page', '--page'], ['selector', '--selector'], ['initScript', '--init-script']]) {
        if (args[key] === true) throw new Error(label + ' 需要一个值（--help 看用法）');
    }
    let page = recoverPagePath(typeof args.page === 'string' ? args.page : DEFAULT_PAGE);
    // 允许直接把整条 URL 交给 --page，少记一个参数。
    const pageAsUrl = /^https?:\/\//.test(page);
    return {
        page: pageAsUrl ? undefined : page.startsWith('/') ? page : '/' + page,
        url: pageAsUrl ? page : typeof args.url === 'string' ? args.url : undefined,
        width: Math.round(readNumber(args, 'width', DEFAULT_WIDTH, '--width')),
        height: Math.round(readNumber(args, 'height', DEFAULT_HEIGHT, '--height')),
        waitMs: readNumber(args, 'waitMs', DEFAULT_WAIT_MS, '--wait-ms'),
        selector: typeof args.selector === 'string' ? args.selector : undefined,
        initScript: readOptionalPath(args, 'initScript'),
        // 给了 --url 就是复用已经跑着的服务，不再自己拉一个。
        noServer: Boolean(args.noServer) || Boolean(args.url) || pageAsUrl,
    };
}

export function targetUrl(options) {
    if (options.url) return options.url;
    return 'http://127.0.0.1:' + DEFAULT_PORT + options.page;
}

async function fetchOk(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function waitForServer(url, timeoutMs, hint) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await fetchOk(url)) return;
        await sleep(300);
    }
    throw new Error('等不到 ' + url + ' 响应（' + Math.round(timeoutMs / 1000) + ' 秒）。\n' + hint);
}

function tail(text, limit = 2000) {
    return text.length > limit ? '…' + text.slice(-limit) : text;
}

async function startDevServer() {
    const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(viteBin)) {
        throw new Error('找不到 vite（' + viteBin + '）：node_modules 没装好。先按仓库说明准备依赖，再重试。');
    }
    const child = spawn(
        process.execPath,
        [viteBin, '--host', '127.0.0.1', '--port', String(DEFAULT_PORT), '--strictPort'],
        { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } },
    );
    let log = '';
    child.stdout.on('data', (chunk) => { log += chunk; });
    child.stderr.on('data', (chunk) => { log += chunk; });
    const base = 'http://127.0.0.1:' + DEFAULT_PORT + '/';

    // vite 打印 ready 时首屏还没编译，直接请求页面才能确认真的能截图。
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error('vite dev server 退出（退出码 ' + child.exitCode + '）：\n' + tail(log.trim())
                + '\n端口 ' + DEFAULT_PORT + ' 可能被占用：先停掉占用的进程，或加 --url 指向已有服务。');
        }
        if (await fetchOk(base)) return { child };
        await sleep(300);
    }
    child.kill();
    throw new Error('vite dev server 60 秒内没有就绪：\n' + tail(log.trim())
        + '\n可以去掉自动启动，先手动跑 npm run dev -- --port ' + DEFAULT_PORT + '，再加 --no-server。');
}

async function stopDevServer(child) {
    if (!child || child.exitCode !== null) return;
    child.kill();
    const deadline = Date.now() + 3000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(100);
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function launchChromium() {
    // 仓库其他地方（playwright.config.ts）也用这个变量指定系统里的浏览器，没装 Playwright 的 chromium 时可以先顶上。
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    try {
        return await chromium.launch({ executablePath: executablePath || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    } catch (error) {
        const message = String(error?.message ?? error);
        if (/Executable doesn't exist|playwright install|browserType\.launch/i.test(message)) {
            throw new Error('本机没有 Playwright 的 chromium，先运行：npx playwright install chromium'
                + '\n（也可以把 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH 指向系统 Chrome。）\n原始错误：' + message);
        }
        throw error;
    }
}

// 打开页面并把未捕获错误交给调用方；退出时保证浏览器和自动拉起的 dev server 都关掉。
export async function withRenderSession(options, run) {
    let server = null;
    let browser = null;
    try {
        if (!options.noServer) {
            server = await startDevServer();
        } else if (!options.url) {
            await waitForServer('http://127.0.0.1:' + DEFAULT_PORT + '/', 5000,
                '--no-server 表示复用已有服务，但 ' + DEFAULT_PORT + ' 端口没有响应：先跑 npm run dev -- --port ' + DEFAULT_PORT + '，或去掉 --no-server。');
        }
        const url = targetUrl(options);
        browser = await launchChromium();
        const context = await browser.newContext({
            viewport: { width: options.width, height: options.height },
            locale: 'zh-CN',
        });
        if (options.initScript) await context.addInitScript({ path: options.initScript });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push({ kind: 'pageerror', message: error.message }));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() });
        });

        let response;
        try {
            response = await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
        } catch (error) {
            throw new Error('打不开 ' + url + '：' + error.message
                + '\n确认 --page 指向仓库里存在的页面（--list 列出根目录页面），或 dev server 是否还在运行。');
        }
        if (response && response.status() >= 400) {
            throw new Error(url + ' 返回 HTTP ' + response.status()
                + '：确认 --page 指向仓库里存在的页面（--list 可列出根目录的页面）。');
        }
        // 字体没落定就截图，同一页两次的字宽会不一样，看起来像布局漂移。
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(options.waitMs);
        await run({ page, errors, url });
    } finally {
        if (browser) await browser.close();
        await stopDevServer(server?.child);
    }
}

export function reportPageErrors(errors, label) {
    const pageErrors = errors.filter((error) => error.kind === 'pageerror');
    const consoleErrors = errors.filter((error) => error.kind === 'console');
    if (consoleErrors.length) {
        console.error('[' + label + '] 控制台错误 ' + consoleErrors.length + ' 条（不影响退出码，供排查）：');
        for (const error of consoleErrors.slice(0, 3)) console.error('  ' + error.message.split('\n')[0]);
    }
    if (pageErrors.length) {
        console.error('[' + label + '] 页面抛了 ' + pageErrors.length + ' 个未捕获错误，结果不可信：');
        for (const error of pageErrors.slice(0, 5)) console.error('  ' + error.message.split('\n')[0]);
        console.error('[' + label + '] 先在本机浏览器打开同一页面修掉错误；如果只是页面里的第三方请求失败，可以改用 --selector 只截改动的区域。');
    }
    return pageErrors.length > 0;
}
