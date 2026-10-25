// ci/openPr.ts
// 一键提 PR：本地门禁 → 推当前分支 → 建发往 dev 的 PR → 打印接下来要盯什么。
// 用法：npm run pr -- "fix: 一句话标题" [--watch] [--skip-ci] [--base dev]
//
// gh（GitHub CLI）是便利工具，不是硬依赖：
//   - 装了 gh 且已登录：直接建 PR，--watch 会盯 CI。
//   - 没装 / 没登录 / 用 SSH 认证：照常 push（SSH 走你自己的 key），然后打印一个 compare 链接，
//     浏览器里点 Create pull request 即可；CI 在 PR 的 Checks 页看，review 在 Files changed 里写。
//
// 所有 CLI 解析都在 main() 里：这个文件会被单测 import，模块顶层不能碰 process.exit。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `用法：npm run pr -- "标题" [选项]

  --base <分支>   目标分支，默认 dev
  --watch         建完 PR 直接盯 CI 到出结果（需要 gh；没有 gh 时打印链接）
  --skip-ci       跳过本地门禁（不建议，CI 会照样拦）

完整例子：
  git switch -c fix/login-timeout origin/dev
  git add -A && git commit -m "fix: 登录超时后不再卡住"
  npm run pr -- "fix: 登录超时后不再卡住"

没装 gh、或用 SSH 认证：同样跑这一条，最后会用浏览器链接代替 gh 建 PR。
`;

/** 从 origin 的 URL 里取出 GitHub 的 owner/repo；HTTPS、ssh://、git@ 三种写法都认。 */
export function githubRepoFromRemote(url: string): { owner: string; repo: string } | null {
    const matched = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(url.trim());
    return matched ? { owner: matched[1], repo: matched[2] } : null;
}

function run(command: string, args: string[], capture = false): string {
    const result = spawnSync(command, args, {
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
        encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
        console.error(`\n[pr] 这一步失败了：${command} ${args.join(' ')}`);
        process.exit(result.status ?? 1);
    }
    return (result.stdout ?? '').trim();
}

function tryRun(command: string, args: string[]): boolean {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

function main(): void {
    const argv = process.argv.slice(2);
    const flags = new Set(argv.filter(arg => arg.startsWith('--')));
    const optionValue = (name: string, fallback: string): string => {
        const index = argv.indexOf(name);
        return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
    };
    const title = argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--base');

    if (flags.has('--help') || flags.has('-h') || argv.length === 0) {
        console.log(USAGE);
        process.exit(argv.length === 0 ? 1 : 0);
    }
    if (!title) {
        console.error('缺少标题。\n\n' + USAGE);
        process.exit(1);
    }
    const prTitle: string = title;
    const base = optionValue('--base', 'dev');
    const watch = flags.has('--watch');
    const skipCi = flags.has('--skip-ci');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    const ghAvailable = tryRun('gh', ['--version']);
    const ghAuthed = ghAvailable && tryRun('gh', ['auth', 'status']);

    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], true);
    if (branch === 'main' || branch === 'dev') {
        console.error(`[pr] 不能直接往 ${branch} 提 PR。先切分支：git switch -c fix/你的改动 origin/dev`);
        process.exit(1);
    }
    if (run('git', ['status', '--porcelain'], true)) {
        console.error('[pr] 还有没提交的改动。先 git add -A && git commit -m "..."，再跑一次。');
        process.exit(1);
    }

    console.log(`\n[pr] 分支 ${branch} → 目标 ${base}\n`);
    if (skipCi) {
        console.warn('[pr] 已跳过本地门禁。规则要求 PR 前必须本地跑通，CI 会照样检查。\n');
    } else {
        console.log('[pr] 1/3 本地门禁（与 CI 同一套）');
        run(npm, ['run', 'ci:local']);
    }

    console.log('\n[pr] 2/3 推分支');
    run('git', ['push', '-u', 'origin', 'HEAD']);

    const remote = githubRepoFromRemote(run('git', ['remote', 'get-url', 'origin'], true));
    const repoUrl = remote ? `https://github.com/${remote.owner}/${remote.repo}` : null;

    if (ghAuthed && repoUrl) {
        console.log('\n[pr] 3/3 建 PR（gh）');
        const body = [
            '## 改了什么',
            '（一句话说明改了什么、为什么）',
            '',
            '## 检查',
            `- [${skipCi ? ' ' : 'x'}] 本地 \`npm run ci:local\``,
            '- [ ] 远端 CI 全绿',
            '- [ ] 已拿到 review（至少 AI review）',
        ].join('\n');
        const url = run('gh', ['pr', 'create', '--base', base, '--title', prTitle, '--body', body], true);
        console.log(url);
        console.log('\n[pr] 接下来必须做：\n  gh pr checks <编号> --watch     # 等到全绿\n  gh pr review <编号> --comment  # 至少一条 AI review，然后才能合');
        if (watch) run('gh', ['pr', 'checks', url, '--watch', '--interval', '30']);
        return;
    }

    // 没有可用的 gh（或仓库不是 GitHub 托管）：交给浏览器，git push 已经走你自己的 SSH/HTTPS 凭据。
    console.log('\n[pr] 3/3 建 PR（浏览器）');
    if (!ghAvailable) console.log('[pr] 没检测到 gh：用下面的链接建 PR 即可，不需要安装。');
    else if (!ghAuthed) console.log('[pr] gh 已安装但没登录：要么 gh auth login，要么直接用下面的链接。');
    if (!repoUrl) {
        console.log('[pr] origin 看起来不是 GitHub 仓库，请到托管页面上手动创建 PR。');
        return;
    }
    const compare = `${repoUrl}/compare/${base}...${branch}?expand=1`;
    console.log(`\n[pr] 打开这个链接，点 “Create pull request”：\n  ${compare}\n`);
    console.log('[pr] 之后：CI 在 PR 页的 Checks 标签看；review 在 Files changed → Review changes → Comment 里写。');
    if (watch) console.log('[pr] --watch 需要 gh；这里只打印链接，盯 CI 请开 Checks 页。');
}

// 只有直接运行才走 CLI；单测 import 时没有副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
