# 本机渲染预览与布局自检

改 UI 的 PR 需要能看见真实页面的截图，而不是只靠读代码。`test/render/` 下有两个脚本：

- `preview.mjs`：用 Playwright 的 chromium 把页面渲染成 PNG。
- `layoutCheck.mjs`：在同一个浏览器里量 DOM，输出 JSON，报溢出、重叠、零尺寸、文本裁切、固定元素遮挡。

两个脚本都直接用仓库 devDependencies 里已有的 `@playwright/test` 和本机 vite dev server，不新增依赖，也不改 `package.json`。

## 一次性准备

```bash
npx playwright install chromium
```

机器上已经装了 Chrome 的话可以不下载浏览器，改用系统浏览器（`playwright.config.ts` 也认这个变量）：

```bash
# bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
# PowerShell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
# cmd
set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

## 渲染预览

```bash
node test/render/preview.mjs --page /dev-probe.html
```

- 默认自动在 5199 端口拉起 vite dev server，截完自动关掉；失败时会给中文提示。
- 产物默认写进 `preview/`（已 gitignore，不进仓库），stdout 只有 PNG 的绝对路径，方便脚本接着处理。
- 文件名是 `<页面>-<宽>x<高>[-<selector>].png`，例如 `preview/dev-probe-1440x1100.png`。

常用参数（完整说明看 `--help`）：

| 参数 | 用途 |
| --- | --- |
| `--page <路径>` | dev server 上的页面，默认 `/dev-probe.html` |
| `--url <地址>` | 截已经跑着的服务（例如 `http://127.0.0.1:3000/`），不再自动起 server |
| `--out <目录>` | 输出目录，默认 `preview/` |
| `--selector <CSS>` | 只截某个元素；找不到会失败并提示 |
| `--width/--height <px>` | 视口尺寸，默认 1440x1100 |
| `--wait-ms <ms>` | 加载后再等多久，默认 1200；异步数据的页面调大 |
| `--init-script <文件>` | 页面脚本前注入，用来写 localStorage 种子数据/登录态 |
| `--no-server` | 复用 5199 上已经跑着的服务 |
| `--list` | 列出可预览的页面和输出目录里已有的截图 |

例子：

```bash
# 首页：dev 下从启动画面到主界面要 10 秒以上，种子数据与等待时间一起给
node test/render/preview.mjs --page / --init-script preview-seed.js --wait-ms 15000

# 只截播放器面板，换手机尺寸
node test/render/preview.mjs --page / --selector '[data-testid="player-panel"]' --width 390 --height 844

# 已经有 dev server 在 3000 端口跑着
node test/render/preview.mjs --url http://127.0.0.1:3000/ --selector h1
```

> Git Bash / MSYS 会把 `/dev-probe.html` 这类参数转成 `C:/Program Files/Git/dev-probe.html`。脚本会按仓库里真实存在的文件还原成页面路径；如果页面不在仓库里，直接给 `--url`。

## 布局自检

```bash
node test/render/layoutCheck.mjs --page /dev-probe.html --json
```

- 有 findings 时 **exit 1**；`--json` 只输出 JSON，默认先打印中文摘要再打印 JSON。
- 参数与 preview 一致（`--page/--url/--selector/--width/--height/--wait-ms/--init-script/--no-server`）。
- 改 UI 时用 `--selector` 限定到改动区域，整页的噪声会少很多。

检查项与口径：

| kind | 判定 |
| --- | --- |
| `viewport-overflow` | 元素横向超出视口，或固定元素四边跑到视口外；页面正常的纵向滚动不算 |
| `click-overlap` | 两个可点元素在两个方向都相交 ≥ 4px；父元素包住子按钮不算 |
| `focus-zero-size` | 可聚焦元素任意一边 < 1px，键盘聚焦时看不见 |
| `text-clipped` | `scrollWidth - clientWidth > 1`（或 scrollHeight 同理） |
| `fixed-occlusion` | 可点元素中心点被固定元素盖住（elementFromPoint 确认），按遮挡元素聚合 |

JSON 结构：

```json
{
  "page": "http://127.0.0.1:5199/dev-probe.html",
  "scope": null,
  "viewport": { "width": 1440, "height": 1100 },
  "counts": { "elements": 293, "clickables": 57, "focusables": 57, "texts": 0, "fixed": 0 },
  "findings": [
    { "kind": "click-overlap", "selector": "button.a ⇄ button.b", "detail": "与 button.b 重叠 50px×20px", "values": { "width": 50, "height": 20 } }
  ]
}
```

有 finding 不等于一定错，但必须有人看图确认；把它当成“需要解释”的清单，而不是可以忽略的警告。

## agent 工作流（必须照做）

1. 改完 UI 先跑预览：`node test/render/preview.mjs ...`。
2. **用图片查看工具实际打开 PNG 看布局**（有 `read_image` 的话直接读文件；人眼看图也算）。不要只看脚本 exit code，也不要凭代码脑补。
3. 跑 `layoutCheck.mjs`，拿到 JSON。
4. 把结果贴进 PR 正文或评论：
   - 截图：拖进 GitHub，或贴在 PR 评论里；
   - JSON：只贴 `counts` 和 `findings` 摘要，不要贴整份长报告；
   - 写清页面路径、视口尺寸、`--wait-ms`、是否注入了种子数据。
5. 在 PR 里明确请求人工确认，例如：
   > 请确认布局是否符合预期（截图见上；layoutCheck 无 findings / 有 N 条 findings，已逐条确认或修复）。
6. 有 findings 就逐条说明是预期还是待修。不要为了“绿”删掉它们或改小阈值。

## 开发者工作流

1. 与 agent 相同：跑预览、跑 layoutCheck、自己看图。
2. 重点看改动区域和周边：错位、遮挡、裁切、溢出。
3. 把截图贴进 PR 并请求人工确认；**人工看完图回复同意后才能合并**。
4. 改 UI 的 PR 如果没截图也没量化结果，review 直接打回。

## 已知限制

- **登录态 / 种子数据**：SPA 首页依赖 localStorage，用 `--init-script` 在页面脚本之前注入（两个脚本都支持）：

  ```js
  // preview-seed.js：放在 preview/ 下（已 gitignore），不要提交
  localStorage.setItem('i18nextLng', 'zh-CN');
  localStorage.setItem('static_mode', 'true');
  localStorage.setItem('last_app_view', 'home');
  // 首次启动的免费软件声明会盖住整页；记成已看，截图和布局检查才能量到下面的界面
  localStorage.setItem('folia_free_software_notice_seen', '1');
  // 指引弹窗按版本判断；版本号跟着 package.json 走，发版后要一起改
  localStorage.setItem('folia_last_seen_ponder_onboarding_version', '0.7.22');
  // 需要在线账号时，从 DevTools → Application → Local Storage 复制真实值；凭据不要提交
  localStorage.setItem('netease_cookie', '...');
  ```

  注入脚本只能写 localStorage/sessionStorage，造不出 IndexedDB 和本地音乐文件；依赖这些数据的页面请先手工准备好开发数据。
- dev 下首页从启动画面到主界面要 10 秒以上（未打包的模块逐个加载），`--wait-ms` 给 15000 更稳；不注入上面那两个启动标记的话，先弹免费软件声明，固定弹窗会挡住布局检查。
- 只量视口内的几何。滚动后才出现的内容不会检查（固定元素除外）。
- 正常滚动容器（`overflow: auto/scroll/hidden`）里的内容不算溢出，按设计跳过。
- 可点元素按语义识别（`a[href]`、`button`、`[role="button"]` 等）；`div` + onClick 的自定义实现识别不到。
- 文本裁切按 scrollWidth/clientWidth 算，横向滚动列表、省略号截断、字体的行高取整都可能被报成裁切，需要人看图判断。
- 弹窗/遮罩打开时，“固定元素遮挡”会一次报很多条：关掉弹窗再量，或用 `--selector` 限定改动区域。
- 截图不是基线：字体、动画、异步数据会让两次截图有差异；要逐像素回归请用 `test/ui` 的 Playwright 截图测试。
- 两个脚本不进 CI：CI 没有浏览器和真实数据，UI 的最终确认靠人。

## 排障

| 现象 | 处理 |
| --- | --- |
| `Executable doesn't exist ... chrome-headless-shell` | `npx playwright install chromium`，或设 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` |
| 端口 5199 被占用 / “Port 5199 is already in use” | 停掉占用进程，或改用 `--url http://127.0.0.1:<端口>/` |
| `--no-server` 提示端口没响应 | 先 `npm run dev -- --port 5199`，再重试 |
| 找不到 selector | 元素还没渲染：调大 `--wait-ms`；或先去掉 `--selector` 截整页确认 |
| 页面 404 | `--list` 看根目录页面；`--page` 要带前导 `/` |
| 页面抛未捕获错误 | 先在本机浏览器打开同一路径修掉；第三方请求失败的控制台错误可以忽略 |
| 白屏 / 骨架 | 数据是异步的：`--wait-ms 5000`，必要时用 `--init-script` 注入种子数据 |
| 想确认脚本本身没坏 | `npx vitest run -c vitest.config.ts test/unit/render` 跑纯函数单测 |

## 相关文件

- `test/render/preview.mjs`、`test/render/layoutCheck.mjs`
- `test/render/renderSession.mjs`：共用的参数解析、dev server、chromium 会话
- `test/render/layoutMetrics.mjs`：纯几何判定与 findings 汇总
- `test/unit/render/layoutMetrics.test.ts`：判定口径的单测
