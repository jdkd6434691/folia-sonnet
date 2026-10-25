#!/usr/bin/env node
// test/render/layoutCheck.mjs
// 在真实浏览器里量布局：溢出视口、可点元素互相重叠、可聚焦元素零尺寸、文本被裁、固定元素遮挡。

import { collectFindings } from './layoutMetrics.mjs';
import { DEFAULT_HEIGHT, DEFAULT_PAGE, DEFAULT_WIDTH, parseArgs, readOptions, reportPageErrors, withRenderSession } from './renderSession.mjs';

const LABEL = 'layoutCheck';
const USAGE = `用法：
  node test/render/layoutCheck.mjs [选项]

选项：
  --page <路径>        dev server 上的页面路径，默认 ${DEFAULT_PAGE}
  --url <地址>         检查已经跑着的服务；给了它就不再自动启动 dev server
  --selector <CSS>     只检查这个元素内部的布局；找不到会失败并提示
  --width <px>         视口宽，默认 ${DEFAULT_WIDTH}
  --height <px>        视口高，默认 ${DEFAULT_HEIGHT}
  --wait-ms <ms>       页面加载后再等多久再量，默认 1200
  --init-script <文件> 页面加载前注入的脚本，用来写 localStorage 种子数据或登录态
  --no-server          不自动启动 vite，复用 5199 端口上的服务
  --json               只输出 JSON（便于贴进 PR 或交给脚本）
  --help               看这份说明

检查项：元素溢出视口、可点元素互相重叠、可聚焦元素零尺寸、文本被裁切、固定元素遮挡可点元素。
有 findings 时 exit 1；stdout 是可复制的 JSON。

例子：
  node test/render/layoutCheck.mjs --page /dev-probe.html
  node test/render/layoutCheck.mjs --page / --selector '[data-testid="player"]' --json`;

// 在页面里执行：只采集矩形和尺寸，是否算问题交给 layoutMetrics.mjs 的纯函数。
function collectLayout({ selector }) {
    const round = (value) => Math.round(value * 100) / 100;
    const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
    };
    const selectorOf = (element) => {
        const parts = [];
        for (let node = element; node && node !== document.body && parts.length < 3; node = node.parentElement) {
            const tag = node.tagName.toLowerCase();
            const id = node.id ? '#' + node.id : '';
            const testId = node.getAttribute('data-testid');
            const classes = Array.from(node.classList).slice(0, 2).map((name) => '.' + name).join('');
            // 没有 id/class/testid 的裸标签（如普通 button）补 nth-of-type，否则报告里分不清是哪一个。
            const bare = !id && !testId && !classes;
            const nth = bare && node.parentElement
                ? ':nth-of-type(' + (Array.from(node.parentElement.children).filter((sibling) => sibling.tagName === node.tagName).indexOf(node) + 1) + ')'
                : '';
            parts.unshift(tag + id + (testId ? '[data-testid="' + testId + '"]' : '') + classes + nth);
        }
        return parts.join(' > ') || element.tagName.toLowerCase();
    };
    const isRendered = (element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return element.getClientRects().length > 0;
    };
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return { missingSelector: true };
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // 滚动容器里的内容本来就会伸出容器和视口，属于设计，不算溢出。
    const clippedByAncestor = (element) => {
        if (getComputedStyle(element).position === 'fixed') return false;
        for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return true;
        }
        return false;
    };

    const overflow = [];
    for (const element of root.querySelectorAll('*')) {
        if (!isRendered(element) || clippedByAncestor(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        // 页面正常纵向滚动时元素在视口下方是预期行为，只查横向溢出；
        // 固定定位的元素无法滚进来，四条边都算。
        const horizontallyOut = rect.left < -1 || rect.right > viewport.width + 1;
        const fixedOut = getComputedStyle(element).position === 'fixed'
            && (rect.top < -1 || rect.bottom > viewport.height + 1);
        // 先留 1px 松量筛掉亚像素噪声，精确容差由 Node 里的 viewportOverflow 决定。
        if (!horizontallyOut && !fixedOut) continue;
        overflow.push({ selector: selectorOf(element), rect: rectOf(element) });
    }

    const CLICKABLE = 'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"], select, textarea';
    const clickableElements = Array.from(root.querySelectorAll(CLICKABLE)).filter(isRendered);
    const indexByElement = new Map(clickableElements.map((element, index) => [element, index]));
    const clickables = clickableElements.map((element, index) => {
        // 记下可点祖先：父元素自己可点、里面又有按钮是正常结构，不是错位。
        const ancestorIds = [];
        for (let node = element.parentElement; node; node = node.parentElement) {
            const ancestorIndex = indexByElement.get(node);
            if (ancestorIndex !== undefined) ancestorIds.push(ancestorIndex);
        }
        return { id: index, selector: selectorOf(element), rect: rectOf(element), ancestorIds };
    });

    const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], summary';
    const focusables = Array.from(root.querySelectorAll(FOCUSABLE))
        .filter(isRendered)
        .map((element) => ({ selector: selectorOf(element), rect: rectOf(element) }));

    const texts = [];
    for (const element of root.querySelectorAll('*')) {
        if (!isRendered(element)) continue;
        const hasText = Array.from(element.childNodes)
            .some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
        if (!hasText) continue;
        const metrics = {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
        };
        // 先按 1px 容差筛一遍，避免把整棵树的指标都传回来。
        if (metrics.scrollWidth - metrics.clientWidth <= 1 && metrics.scrollHeight - metrics.clientHeight <= 1) continue;
        texts.push({ selector: selectorOf(element), metrics });
    }

    let fixedCount = 0;
    for (const element of root.querySelectorAll('*')) {
        if (getComputedStyle(element).position !== 'fixed' || !isRendered(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) fixedCount += 1;
    }

    // 遮挡用 elementFromPoint 判定：中心点命中的元素如果有固定定位的祖先，说明它真的盖在上面。
    const fixedOcclusions = [];
    for (const target of clickables) {
        if (target.rect.width < 1 || target.rect.height < 1) continue;
        const x = target.rect.x + target.rect.width / 2;
        const y = target.rect.y + target.rect.height / 2;
        if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
        let node = document.elementFromPoint(x, y);
        if (!node) continue;
        while (node && node !== document.documentElement && getComputedStyle(node).position !== 'fixed') {
            node = node.parentElement;
        }
        if (!node || node === document.documentElement) continue;
        const targetElement = clickableElements[target.id];
        if (node.contains(targetElement) || targetElement.contains(node)) continue;
        fixedOcclusions.push({
            target: { selector: target.selector, rect: target.rect },
            blocker: { selector: selectorOf(node), rect: rectOf(node) },
        });
    }

    return {
        viewport,
        counts: {
            elements: root.querySelectorAll('*').length,
            clickables: clickables.length,
            focusables: focusables.length,
            texts: texts.length,
            fixed: fixedCount,
        },
        overflow,
        clickables,
        focusables,
        texts,
        fixedOcclusions,
    };
}

async function waitForSelector(page, selector) {
    try {
        await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
        throw new Error('找不到 selector：' + selector
            + '\n先确认页面渲染出了这个元素；它如果是异步出现的，加 --wait-ms 多等一会，或去掉 --selector 检查整页。');
    }
}

function printReport(result) {
    const scope = result.scope ? '，范围 ' + result.scope : '';
    console.log('[' + LABEL + '] 页面 ' + result.page + '（视口 ' + result.viewport.width + 'x' + result.viewport.height + scope + '）');
    const counts = result.counts;
    console.log('[' + LABEL + '] 量了 ' + counts.elements + ' 个元素：可点 ' + counts.clickables
        + '、可聚焦 ' + counts.focusables + '、有裁切风险的文本 ' + counts.texts + '、固定元素 ' + counts.fixed);
    if (result.findings.length === 0) {
        console.log('[' + LABEL + '] 没有发现布局问题。');
    } else {
        console.log('[' + LABEL + '] 发现 ' + result.findings.length + ' 处需要人工确认的问题：');
        for (const finding of result.findings) {
            console.log('  - [' + finding.kind + '] ' + finding.selector);
            console.log('    ' + finding.detail);
        }
    }
    console.log(JSON.stringify(result, null, 2));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(USAGE);
        return;
    }
    const options = readOptions(args);
    let result = null;
    let sessionErrors = [];
    await withRenderSession(options, async ({ page, errors, url }) => {
        if (options.selector) await waitForSelector(page, options.selector);
        const collected = await page.evaluate(collectLayout, { selector: options.selector ?? null });
        if (collected.missingSelector) {
            throw new Error('找不到 selector：' + options.selector + '（页面已加载，但这个选择器没匹配到元素）');
        }
        result = {
            page: url,
            scope: options.selector ?? null,
            viewport: collected.viewport,
            counts: collected.counts,
            findings: collectFindings(collected),
        };
        sessionErrors = errors;
    });

    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printReport(result);
    if (result.findings.length > 0) process.exitCode = 1;
    if (reportPageErrors(sessionErrors, LABEL)) process.exitCode = 1;
}

main().catch((error) => {
    console.error('[' + LABEL + '] 失败：' + error.message);
    process.exitCode = 1;
});
