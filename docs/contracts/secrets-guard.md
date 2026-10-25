# 密钥门禁（secrets guard）

`ci/checkSecrets.ts` 守的是「有人把密钥写进仓库、或写进前端包」这条线。它不装依赖、不需要 `npm ci`，
Node 24 直接跑 TypeScript。

- 源码：`node ci/checkSecrets.ts` — `.env.example` 与 `src/`、`electron/`、`shared/`、`api/`
- 产物：`node ci/checkSecrets.ts --dist dist` — `vite build` 之后扫 `dist/**`

失败时输出 `文件:行  原因`，退出码 1。命中的密钥值只打印开头几位：日志本身不能再当一次泄漏的渠道。

## 检查项

| 检查 | 扫哪 | 为什么失败 |
|---|---|---|
| `VITE_` 变量名里含 `KEY` / `TOKEN` / `SECRET` / `PASSWORD` / `CREDENTIAL` / `AUTH` | 源码 | Vite 会把 `VITE_*` 的值内联进前端包，等于对所有人公开。`import.meta.env.VITE_X_API_KEY` 这种访问同样命中 |
| `sk-` 后接 20 位以上、`AIza` 后接 30 位以上、`ghp_`、`github_pat_`、`xox[baprs]-`、`Bearer ` 后接 20 位以上 | 源码 + 产物 | 常见服务签发的明文密钥形态，出现在仓库或包里只有一种解释 |
| 环境里配置的密钥值 | 产物 | 名字含 `KEY`/`TOKEN`/… 且值不像示例值（`your_…` 等）的环境变量，其值被内联进了包 |
| 上面的密钥形态 | 产物 | 依赖或构建产物把密钥带进了前端包 |

`.env.example` 里的 `GEMINI_API_KEY` / `OPENAI_API_KEY` 不受第一条约束：它们没有 `VITE_` 前缀，Vite 不会内联，
值也是 `your_…` 占位符。

## allowlist

`ci/secretsAllowlist.json` 是唯一的放行方式，按「文件 + 命中原文」精确匹配（不是正则）：

```json
{
    "allow": [
        {
            "file": "src/utils/exampleFixture.ts",
            "match": "sk-abcdefghijklmnopqrstuvwxyz123456",
            "reason": "文档示例里的假值，不指向任何真实服务"
        },
        {
            "file": "dist/*",
            "match": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
            "reason": "youtubei.js 自带的 YouTube 公开 Innertube key，是依赖的一部分"
        }
    ]
}
```

- `file` 是仓库相对路径，用 `/` 分隔；`match` 必须和命中的原文完全一致。
- `file` 以 `*` 结尾时表示这个目录下的任何文件——产物的文件名带内容哈希，只能这样放行。
- `reason` 必写：缺了直接报错、门禁红。没有理由的白名单，就是下一次泄漏的入口。
- 只放明显假值和第三方公开值。真实密钥要吊销并清理，不是加进来。

上面 JSON 里那条 `src/utils/exampleFixture.ts` 只是格式示例，真实文件里没有。现在只有两条：
`youtubei.js` 打包进 `dist` 的 YouTube 公开 Innertube key。它们不是本项目的凭据，但形态与 Google API key
一样，所以按值放行；依赖升级换了 key 会红，届时核对来源再更新。

扫描范围就是开头那六处。`test/`、`docs/`、`dev/`、`api-ts/`、`sync-server/` 都不看：那里本来就是夹具和
示例的常见位置，扫了只会逼人把假值写进 allowlist。有意放进源码目录的假值才需要这一条。

## 本地怎么跑

```bash
node ci/checkSecrets.ts                                # 源码，秒级
npm run build && node ci/checkSecrets.ts --dist dist   # 产物，要等构建
```

CI 里是两处：`secret-guard` job 跑源码扫描（不需要 `npm ci`），`build-web` 在 `npm run build` 之后跑产物扫描。
本轮不动 `package.json`，所以没有对应的 `npm run` 脚本，命令就是上面这两条。

## 红了怎么办

- **`VITE_` 名字**：凭据不要给前端。服务端用不带 `VITE_` 前缀的变量，前端只拿地址、开关这类公开配置。
- **明文密钥**：删掉代码里的值、吊销换新的，再按团队流程清理历史；不要只做一次 amendment。
- **产物命中**：看命中的是哪个文件，顺着那串值找来源（依赖、构建期注入、`import.meta.env`）。
- **确实只是假值**：加进 `ci/secretsAllowlist.json` 并写清理由。

## 这条门禁不覆盖什么

- **运行时日志**：由 `src/utils/errorText.ts` 的 `errorMessage` / `errorFields` 在交出文本前隐去凭据，
  `test/unit/security/logRedaction.test.ts` 钉住这一行为；别的自拼日志仍可能漏。
- **git 历史**：只扫当前工作树。
- **同步/导出 payload**：结构上没有凭据字段，由 `test/unit/security/exportPayloads.test.ts` 按结构钉住
  （同步文档、外观配置短码）；以后往 payload 里加名字像凭据的字段，那条用例会红。
