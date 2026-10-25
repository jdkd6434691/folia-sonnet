#!/usr/bin/env node
// test/render/preview.mjs
// 把 dev server 上的页面渲染成 PNG，本机改完 UI 后先看一眼真实布局再请求人工确认。

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_HEIGHT, DEFAULT_PAGE, DEFAULT_WIDTH, parseArgs, readOptions, repoRoot, reportPageErrors, withRenderSession } from './renderSession.mjs';

const LABEL = 'render-preview';
const USAGE = `用法：
  node test/render/preview.mjs [选项]

选项：
  --page <路径>        dev server 上的页面路径，默认 ${DEFAULT_PAGE}
  --url <地址>         截已经跑着的服务；给了它就不再自动启动 dev server
  --out <目录>         截图输出目录，默认 preview/
  --selector <CSS>     只截某个元素；找不到会失败并提示
  --width <px>         视口宽，默认 ${DEFAULT_WIDTH}
  --height <px>        视口高，默认 ${DEFAULT_HEIGHT}
  --wait-ms <ms>       页面加载后再等多久，默认 1200；数据是异步来的就调大
  --init-script <文件> 页面加载前注入的脚本，用来写 localStorage 种子数据或登录态
  --no-server          不自动启动 vite，复用 5199 端口上的服务
  --list               列出可预览的页面和输出目录里已有的截图
  --help               看这份说明

例子：
  node test/render/preview.mjs --page /dev-probe.html
  node test/render/preview.mjs --page / --width 1280 --height 800 --out preview/home
  node test/render/preview.mjs --url http://127.0.0.1:3000/ --selector '[data-testid="player"]'
  node test/render/preview.mjs --page / --init-script preview-seed.js --wait-ms 15000

产物默认在 preview/ 下（已 gitignore），stdout 只输出 PNG 的绝对路径。`;

function slug(value) {
    return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function fileNameFor(url, options) {
    const parsed = new URL(url);
    // data: / file: 这类地址没有有意义的 pathname，统一叫 index；页面名也截断，避免路径变成文件名。
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const pathname = isHttp ? parsed.pathname : '/';
    const base = pathname === '/' ? 'index' : pathname.slice(pathname.lastIndexOf('/') + 1).replace(/\.html?$/i, '');
    const pageName = (slug(base) || 'index').slice(0, 40);
    const selectorPart = options.selector ? '-' + slug(options.selector).slice(0, 40) : '';
    return pageName + selectorPart + '-' + options.width + 'x' + options.height + '.png';
}

function outputDir(args) {
    return path.resolve(process.cwd(), typeof args.out === 'string' ? args.out : 'preview');
}

function listPages(args) {
    console.log('可预览的页面（--page）：');
    for (const name of fs.readdirSync(repoRoot).filter((file) => file.endsWith('.html')).sort()) {
        console.log('  /' + name);
    }
    const dir = outputDir(args);
    const shots = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith('.png')).sort() : [];
    console.log('');
    console.log('已有截图（' + dir + '）：');
    if (shots.length === 0) console.log('  （还没有，先跑一次 preview.mjs）');
    for (const name of shots) console.log('  ' + name);
}

async function screenshot(page, options, file) {
    if (!options.selector) {
        await page.screenshot({ path: file });
        return;
    }
    const locator = page.locator(options.selector).first();
    try {
        await locator.waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
        throw new Error('找不到 selector：' + options.selector
            + '\n先确认页面渲染出了这个元素；它如果是异步出现的，加 --wait-ms 多等一会，或去掉 --selector 截整页。');
    }
    await locator.screenshot({ path: file });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(USAGE);
        return;
    }
    if (args.list) {
        listPages(args);
        return;
    }
    if (args.out === true) throw new Error('--out 需要一个目录');
    const options = readOptions(args);
    const dir = outputDir(args);
    fs.mkdirSync(dir, { recursive: true });

    let file = '';
    let sessionErrors = [];
    await withRenderSession(options, async ({ page, errors, url }) => {
        console.error('[' + LABEL + '] 页面 ' + url + '（视口 ' + options.width + 'x' + options.height + '）');
        file = path.join(dir, fileNameFor(url, options));
        await screenshot(page, options, file);
        sessionErrors = errors;
    });

    console.log(file);
    if (reportPageErrors(sessionErrors, LABEL)) process.exitCode = 1;
}

main().catch((error) => {
    console.error('[' + LABEL + '] 失败：' + error.message);
    process.exitCode = 1;
});
