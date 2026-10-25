// ci/checkSecrets.ts
// 密钥泄漏门禁：源码里不该出现的 VITE_ 凭据变量名与明文密钥形态，打包产物里不该出现的密钥值。
//   node ci/checkSecrets.ts                扫 .env.example 与 src/、electron/、shared/、api/
//   node ci/checkSecrets.ts --dist dist    扫 vite build 的产物（ci.yml 的 build-web 跑这条）
// 失败时输出 文件:行 与原因，退出码 1。检查项清单与 allowlist 规则见 docs/contracts/secrets-guard.md。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 import.meta.url 而不是 import.meta.dirname：这份文件也会被 vitest 打包执行，那里只保证有 url。
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWLIST_FILE = 'ci/secretsAllowlist.json';
// 源码检查的范围。.env.example 单独列：它是唯一提交进仓库、又不在目录里的环境变量文件。
const SOURCE_FILES = ['.env.example'];
const SOURCE_DIRS = ['src', 'electron', 'shared', 'api'];
// 密钥只可能出现在文本里；读二进制既慢，也会把随机字节当成命中。
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.webm', '.m4a',
    '.zip', '.gz', '.tar', '.br', '.pdf', '.bin', '.node', '.dll', '.exe', '.so', '.dylib',
    '.db', '.sqlite', '.wasm',
]);

// Vite 会把 VITE_ 开头的变量内联进前端包：名字里带这些词的，值等于公开在 JS 里。
const VITE_CREDENTIAL_NAME = /VITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*/gi;

/** 常见服务签发的明文密钥形态。命中只有一种解释：把真密钥写进了仓库。 */
export const SECRET_SHAPES: { reason: string; pattern: RegExp }[] = [
    { reason: 'sk- 开头的 API key（OpenAI 等）', pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
    { reason: 'Google API key（AIza 开头）', pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
    { reason: 'GitHub token（ghp_ 开头）', pattern: /\bghp_[A-Za-z0-9]{20,}/g },
    { reason: 'GitHub token（github_pat_ 开头）', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
    { reason: 'Slack token（xox[baprs]- 开头）', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
    { reason: 'Bearer 后面的 token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
];

// 产物里找的环境变量：名字像凭据、值又不像是示例值的。
const SECRET_ENV_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i;
const PLACEHOLDER_VALUE = /^(?:your|example|placeholder|change|dummy|sample|test|none|null|true|false|localhost)/i;

export interface Finding {
    /** 仓库相对路径（源码）或 --dist 给的目录下的路径（产物），用 / 分隔。 */
    file: string;
    line: number;
    reason: string;
    /** 命中的原文。只用来对 allowlist，打印时走 maskHit。 */
    hit: string;
    /** 命中的是密钥值本身（要打码），还是变量名（名字不是秘密）。 */
    secret: boolean;
}

/** 命中片段只露开头几位，太短的整段隐去：日志本身不能再当一次泄漏的渠道。 */
export const maskHit = (hit: string): string => (hit.length < 12 ? '…' : hit.slice(0, 6) + '…');

export interface AllowEntry {
    /** 仓库相对路径；以 * 结尾表示这个目录下的任何文件（产物文件名带内容哈希）。 */
    file: string;
    /** 命中的原文，精确匹配，不是正则。 */
    match: string;
    /** 为什么这是假值/公开值。缺了就是错。 */
    reason: string;
}

/**
 * 读 allowlist。每条都必须写清文件、命中的原文和理由：没有理由的白名单，就是下一次泄漏的入口。
 * 写错（缺字段、不是数组）直接抛，宁可门禁红，也不要静默放行。
 */
export function loadAllowlist(root: string = repoRoot): AllowEntry[] {
    const file = path.join(root, ALLOWLIST_FILE);
    if (!fs.existsSync(file)) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(ALLOWLIST_FILE + ' 不是合法 JSON：' + String(error));
    }
    const allow = (parsed as { allow?: unknown }).allow;
    if (allow === undefined) return [];
    if (!Array.isArray(allow)) throw new Error(ALLOWLIST_FILE + ' 的 allow 必须是数组');
    const fields = ['file', 'match', 'reason'] as const;
    return allow.map((entry, index) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        for (const field of fields) {
            if (typeof record[field] !== 'string' || (record[field] as string).trim() === '') {
                throw new Error(ALLOWLIST_FILE + ' 第 ' + (index + 1) + ' 条缺少 ' + field + '（文件、命中的原文、理由三样都要写）');
            }
        }
        return { file: (record.file as string).trim(), match: record.match as string, reason: (record.reason as string).trim() };
    });
}

// 产物文件名带内容哈希，没法按整条路径放行：file 允许以 * 结尾，表示这个目录下的任何文件。
const matchesFile = (pattern: string, file: string): boolean => (
    pattern.endsWith('*') ? file.startsWith(pattern.slice(0, -1)) : pattern === file
);

const isAllowed = (finding: Finding, allow: AllowEntry[]): boolean => allow.some(
    entry => matchesFile(entry.file, finding.file) && entry.match === finding.hit,
);

/** 逐行扫一段文本：行号就是报错里的行号，命中不会跨行。 */
export function scanText(file: string, text: string, allow: AllowEntry[] = []): Finding[] {
    const findings: Finding[] = [];
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        for (const matched of line.matchAll(VITE_CREDENTIAL_NAME)) {
            findings.push({
                file,
                line: index + 1,
                reason: 'VITE_ 凭据变量 ' + matched[0] + ' 会被 Vite 内联进前端包，值等于公开',
                hit: matched[0],
                secret: false,
            });
        }
        for (const shape of SECRET_SHAPES) {
            for (const matched of line.matchAll(shape.pattern)) {
                findings.push({ file, line: index + 1, reason: shape.reason, hit: matched[0], secret: true });
            }
        }
    }
    return findings.filter(finding => !isAllowed(finding, allow));
}

interface CollectedFile {
    /** 相对根目录的路径，用 / 分隔，报错时直接能看懂。 */
    relative: string;
    absolute: string;
}

function collectFiles(root: string, relative: string, out: CollectedFile[]): void {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const next = relative === '' ? entry.name : relative + '/' + entry.name;
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            collectFiles(root, next, out);
            continue;
        }
        if (!entry.isFile()) continue;
        if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        out.push({ relative: next, absolute: path.join(root, relative, entry.name) });
    }
}

/** 源码扫描：.env.example 与四个源码目录。 */
export function scanSources(root: string = repoRoot, allow: AllowEntry[] = loadAllowlist(root)): Finding[] {
    const findings: Finding[] = [];
    for (const relative of SOURCE_FILES) {
        const absolute = path.join(root, relative);
        if (!fs.existsSync(absolute)) continue;
        findings.push(...scanText(relative, fs.readFileSync(absolute, 'utf8'), allow));
    }
    for (const dir of SOURCE_DIRS) {
        const files: CollectedFile[] = [];
        collectFiles(root, dir, files);
        for (const file of files) findings.push(...scanText(file.relative, fs.readFileSync(file.absolute, 'utf8'), allow));
    }
    return findings;
}

/** 产物里不该出现自己签发的密钥值：环境里配的 GEMINI_API_KEY 之类被内联进包，就是泄漏。 */
export function secretEnvEntries(env: NodeJS.ProcessEnv = process.env): { name: string; value: string }[] {
    return Object.entries(env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .filter(([name, value]) => SECRET_ENV_NAME.test(name)
            && value.trim().length >= 8
            && !PLACEHOLDER_VALUE.test(value.trim()))
        .map(([name, value]) => ({ name, value: value.trim() }));
}

/** 产物扫描：dist 下每个文本文件都查密钥形态和已配置的环境变量值。 */
export function scanDist(dir: string, env: NodeJS.ProcessEnv = process.env, allow: AllowEntry[] = loadAllowlist()): Finding[] {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error('找不到产物目录 ' + dir + '：先跑一次构建，或检查 --dist 的路径');
    }
    const files: CollectedFile[] = [];
    collectFiles(dir, '', files);
    const secrets = secretEnvEntries(env);
    // 报错里的路径与 CI 用的写法一致：目录在仓库里就写仓库相对路径，allowlist 才不用跟着调用方式变。
    const relative = path.relative(repoRoot, path.resolve(dir));
    const insideRepo = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    const label = (insideRepo ? relative : dir).replace(/\\/g, '/').replace(/\/+$/, '');
    const findings: Finding[] = [];
    for (const file of files) {
        const text = fs.readFileSync(file.absolute, 'utf8');
        findings.push(...scanText(label + '/' + file.relative, text, allow));
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            for (const secret of secrets) {
                if (!lines[index].includes(secret.value)) continue;
                findings.push({
                    file: label + '/' + file.relative,
                    line: index + 1,
                    reason: '产物里出现了环境变量 ' + secret.name + ' 的值',
                    hit: secret.value,
                    secret: true,
                });
            }
        }
    }
    return findings;
}

function describe(finding: Finding): string {
    return finding.file + ':' + finding.line + '  ' + finding.reason + '  ' + (finding.secret ? maskHit(finding.hit) : finding.hit);
}

const USAGE = '用法：node ci/checkSecrets.ts [--dist <目录>]';

function report(headline: string, passed: string, scan: () => Finding[]): void {
    try {
        const findings = scan();
        if (findings.length === 0) {
            console.log(passed);
            return;
        }
        console.error(headline + findings.length + ' 处密钥泄漏风险（规则见 docs/contracts/secrets-guard.md）：');
        for (const finding of findings) console.error('  ' + describe(finding));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
}

function main(): void {
    const args = process.argv.slice(2);
    const distIndex = args.findIndex(arg => arg === '--dist' || arg.startsWith('--dist='));
    if (distIndex === -1) {
        if (args.length > 0) {
            console.error(USAGE);
            process.exitCode = 1;
            return;
        }
        report('发现 ', '密钥检查通过：源码里没有 VITE_ 凭据变量名，也没有常见形态的明文密钥。', scanSources);
        return;
    }
    const flag = args[distIndex];
    const dir = flag.startsWith('--dist=') ? flag.slice('--dist='.length) : args[distIndex + 1];
    if (!dir || (flag === '--dist' && args.length > distIndex + 2)) {
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }
    report('产物 ' + dir + ' 里发现 ', '产物密钥检查通过：' + dir + ' 里没有密钥形态，也没有环境变量里的密钥值。', () => scanDist(dir));
}

// 只有直接 `node ci/checkSecrets.ts` 才跑检查；被单测 import 时不产生副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
