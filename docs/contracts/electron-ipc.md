# Electron IPC 契约（渲染进程 ↔ 主进程）

桌面端唯一的渲染进程出口是 `electron/preload.cjs` 用 `contextBridge` 暴露的 `window.electron`。这份文档写它暴露了什么、怎么调、回什么、错成什么样，以及为什么渲染进程拿不到比这更多的东西。

- 权威文件：`electron/preload.cjs`（暴露面）、`src/vite-env.d.ts` 的 `Window['electron']`（类型与可空性，`777-1097`）、各 `electron/**` 里的 `ipcMain.handle/on`（实现）。
- 规则来源：`AGENTS.md`「渲染进程只经 `electron/preload.cjs` 暴露的接口找主进程。窗口都开 `contextIsolation`、关 `nodeIntegration`。」

## 1. 安全边界

| 项 | 现状 | 依据 |
| --- | --- | --- |
| `contextIsolation` | `true`（两个窗口都是） | `electron/main.cjs:5517`、`5340` |
| `nodeIntegration` | `false` | `electron/main.cjs:5516`、`5339` |
| `webSecurity` | `true` | `electron/main.cjs:5518`、`5341` |
| 沙箱 | 未显式设置 `sandbox`，走 Electron 默认（渲染进程沙箱开启）；preload 只用 `electron` 模块与 `process` 的少量字段 | `electron/preload.cjs:1`、`59-63`、`79-80` |
| 页面能拿到什么 | 只有 `window.electron` 这一个对象：`contextBridge.exposeInMainWorld('electron', {...})`。`ipcRenderer`、`require`、`fs` 都没有暴露 | `electron/preload.cjs:1-3` |
| preload 装在哪 | 主窗口与远程控制窗口都装同一份 `preload.cjs`；远程控制窗口是同一个前端带 `?remote=1` 打开 | `electron/main.cjs:5515`、`5338`、`5363` |
| 网页版 | 没有 `window.electron`。类型里写成可选（`electron?: {...}`），**每个调用点都必须用可选链并处理缺失** | `src/vite-env.d.ts:777` |
| 权限请求 | 只有「受信主窗口 + 允许的权限」才放行；其余一律 `callback(false)` | `electron/main.cjs:3528-3548` |

渲染进程里不存在「直接 require 主进程模块」这条路：能做的只有下列函数与事件。想加新能力，先加 preload 成员 + 主进程 handler（见 §7）。

## 2. `window.electron` 的形状

```ts
window.electron?.                      // 网页版没有，所以是可选
  // 值的属性（不是函数）
  platform: string                     // process.platform，preload.cjs:79
  isLinuxX11: boolean                  // linux 且没有 WAYLAND_DISPLAY，preload.cjs:80
  webUtils.getPathForFile(file: File): string   // preload.cjs:4-8
  // 约 125 个顶层 invoke 函数、6 个单向 send、31 个顶层事件订阅；
  // 另有 mods 子命名空间（20 个函数 + 5 个事件）
  mods?: { ... }                       // preload.cjs:342-388
```

- 函数参数是**按位置传**的，不是单个对象：`saveAudioCache(cacheKey, data, mimeType, limitBytes)`（`preload.cjs:142`、`vite-env.d.ts:909`）。主进程 handler 的形参与之一一对应。
- 返回值一律是 `Promise`（`ipcRenderer.invoke`），值必须能**结构化克隆**：普通对象、数组、`ArrayBuffer`、`Float32Array`、`Uint8Array` 可以；函数、类实例、`Error` 对象不能。所以错误都以「结果对象」或拒绝来表达，不靠传异常。
- 大数据分块传：视频导出走 `openVideoExportFile` → 多次 `appendVideoExportChunk` → `finishVideoExportFile`（`preload.cjs:304-307`、`vite-env.d.ts:1053-1056`）。

## 3. invoke：请求/响应

- 预期内的失败**用返回值表达**，不让 Promise 拒绝：`null`（能力不适用）、`false`（没做成）、`{ ok: false, error: { code, message } }`（平台桥）。
  - 例：`kugou-api-status` 对不可信发送方回 `null`（`main.cjs:6833-6839`）；`bodian/ytm/spotify/qishui-api-request` 对不可信发送方回 `{ ok:false, error:{ code:'unavailable', message:'Untrusted ... request' } }`（`main.cjs:6845-6873`）。
- 抛错只用于**信任边界或编程错误**：发送方守卫对非第一方窗口直接 `throw`（`electron/ipcAccessGuard.cjs:13-25`）。此时渲染进程拿到的是被拒绝的 Promise；拒绝消息由 Electron 包装成 `Error invoking remote method '<通道名>': ...`（Electron 行为，不是仓库代码）。调用方按「意外失败」处理，不要拿它当业务分支。
- 「测试连接」这类接口刻意永不因连接失败而拒绝，而是回结果对象：`testAiConnection` → `AiConnectionTestResult`（`vite-env.d.ts:929-930`；两家的实现分别在 `electron/aiTextClient.cjs`、`electron/ai/anthropicClient.cjs`）。

## 4. send：单向通道（6 条）

没有返回值、无法确认是否执行成功，只用于「通知一下」：

| `window.electron` 成员 | 通道 | 方向用途 | 依据 |
| --- | --- | --- | --- |
| `setAutomixEnabled` | `automix-enabled` | 开关分析进程里的 htdemucs | `preload.cjs:20`、`analysis/host.cjs:254` |
| `diagMark` | `automix-diag` | 往运行日志写一行阶段标记 | `preload.cjs:25`、`analysis/host.cjs:305` |
| `debugWriteRuntimeLines` | `debug-runtime-lines` | 批量写运行日志 | `preload.cjs:35`、`debug/debugHost.cjs:348` |
| （内部）`onDebugMainLines` 注册时 | `debug-main-lines-ready` | 订阅主进程日志后要 backlog | `preload.cjs:46`、`debug/debugHost.cjs:369` |
| `debugReportRendererMemory` | `debug-renderer-memory` | 回传渲染进程自报的内存 | `preload.cjs:73`、`debug/debugHost.cjs:356` |
| `setWallpaperHitRegions` | `wallpaper-hit-regions` | macOS 壁纸模式的点击拦截矩形 | `preload.cjs:116`、`main.cjs:6298` |

## 5. 事件：主进程 → 渲染进程

订阅函数都返回**取消订阅函数**，调用方在 effect cleanup 里调它：

```ts
const off = window.electron?.onUpdateStatusChanged(status => setStatus(status));
return () => off?.();
```
典型实现见 `preload.cjs:135-139`。一个例外要看清：`onDebugMainLines` 在收到第一段 backlog 之前会丢弃先到的推送，避免刷新后日志顺序颠倒（`preload.cjs:37-48`）。

按域分组（通道名 → 载荷）：

| 域 | 事件（括号内是回调载荷要点） | 依据 |
| --- | --- | --- |
| 设置/壁纸 | `wallpaper-mode-changed`、`wallpaper-transparent-refused`（settings）、`wallpaper-entry-requested`、`wallpaper-input-monitor-requested`、`wallpaper-accessibility-suggested`、`wallpaper-displays-changed`（显示状态） | `preload.cjs:83-115` |
| 节流/全屏/主题 | `background-throttling-changed`（`{active,hidden}`）、`window-fullscreen-changed`（boolean）、`main-window-click-through-changed`（状态） | `preload.cjs:119-123`、`194-198`、`214-218` |
| 更新 | `update-status-changed`（`ElectronUpdateStatus`） | `preload.cjs:135-139` |
| 本地后端 | `netease-api-status-changed`、`qq-api-status-changed` | `preload.cjs:169-186` |
| 播放交接 | `window-playback-handoff-requested`（`{ requestId }`） | `preload.cjs:203-207` |
| 外部集成 | `lyric-api-status-changed`、`obs-browser-source-status-changed`、`discord-presence-status-changed`、`playback-sync-bridge-status-changed`、`voice-input-state-changed` | `preload.cjs:228-256` |
| 系统快捷键/任务栏 | `global-shortcut-triggered`（accelerator）、`thumbar-action` | `preload.cjs:259-269` |
| 远程控制 | `remote-control-window-settings-changed`、`remote-control-pointer-inside`（boolean）、`remote-control-command`、`remote-control-snapshot` | `preload.cjs:276-299` |
| 舞台 | `stage-session-updated`/`stage-session-cleared`（`StageStatus`）、`stage-external-play-request`、`stage-player-control-request`、`stage-player-queue-request` | `preload.cjs:316-340` |
| 调试 | `debug-main-lines`（`(lines, isBacklog)`）、`debug-memory-sample` | `preload.cjs:37-48`、`74-78` |
| mods | `folia-mods:state-changed`、`:export-progress`、`:log`、`:rpc-message`、`:secret-changed` | `preload.cjs:363-387` |

## 6. 分域函数（签名与返回值以 `src/vite-env.d.ts` 为准）

`vite-env.d.ts` 是这个 API 的 TypeScript 契约；下表只给定位与要点，避免两处抄同一份签名。

| 域 | 代表函数 | 类型位置 | 实现要点 |
| --- | --- | --- | --- |
| 设置 | `getSettings()`、`saveSettings(key, value)` | `859-860` | `getSettings` 只回公开设置：AI Key 只回 `AI_API_KEYS_CONFIGURED` 布尔（`aiCredentialStore.cjs:217-228`）。`saveSettings` 拒绝 AI 凭据键、密文键与 `OPENAI_API_KEY_ENDPOINT`（`main.cjs:6329-6344`） |
| 窗口 | `minimizeWindow`、`toggleMaximizeWindow`、`toggleFullscreenWindow`、`closeWindow`、`quitApp`、置顶/点击穿透/透明模式/播放交接 | `973-1000` | 都先校验 sender 是主窗口（`main.cjs:6875-7055`） |
| 缓存 | 音频缓存、封面缓存、本地封面资源 | `906-925` | 磁盘操作失败即回 `false`/空值，不抛（`main.cjs:6730-6806`） |
| 更新 | `getUpdateStatus`、`checkForUpdates`、`downloadUpdate`、`quitAndInstallUpdate`、`openUpdateReleasePage` | `898-905` | 见 `main.cjs:6689-6713` |
| AI | `generateTheme`、`segmentLyrics`、`testAiConnection`、`listAiModels` | `926-931` | 主进程持 Key；表单里刚输入的 Key 随请求传，空串表示「用已保存的」（`vite-env.d.ts:50-57`） |
| 在线平台桥 | `kugouRequest`、`qishuiRequest`、`bodianRequest`、`ytmRequest`、`spotifyRequest`、`getNeteasePort/Status`、`getQqPort/Status` | `940-972` | 操作白名单在各自桥里；sender 校验在主进程（`main.cjs:6820-6873`）。唯一同时信主窗口与远程控制窗口的是酷狗（`main.cjs:6829-6844`） |
| 诊断 | `getLoginDiagnostics`、`runLoginSelfCheck`、`fetchLyricProxy` | `932-945` | 诊断只含可公开贴出的内容，不含 cookie/token/IP（`src/types/onlineMusic.ts:279,306,715-716`） |
| 本地服务 | `restartNeteaseApi`、状态事件 | `940-948` | 只为「要用它却断网没起来」重启，有退避（`electron/backendLifecycle.cjs`） |
| 外部集成 | `getObsBrowserSourceStatus`/`publishObsBrowserSource*`、`getLyricApiStatus`/`publishLyricApiData`、Discord、播放同步、语音输入 | `1001-1018` | 主进程起本地 HTTP 服务；渲染进程只推快照。Token 在主进程（见 [secrets.md](secrets.md)） |
| 快捷键/任务栏 | `getGlobalShortcutBackend`、`setGlobalShortcuts`、`updateTaskbarControls` | `1019-1025` | 原生 Wayland 走 `portal`（`vite-env.d.ts:1019-1022`） |
| 远程控制 | `openRemoteControl`/`toggleRemoteControl`/`closeRemoteControl`、快照与命令 | `1026-1041` | 主窗口发命令，远程控制窗口收事件 |
| 视频导出 | 选路径、准备/恢复窗口、分块写文件 | `1042-1056` | 块按序 append，`finish` 才把临时文件改名到目标路径（`main.cjs:7448-7578`） |
| 舞台 | `getStageStatus`、`setStageEnabled`、`regenerateStageToken`、发布快照、完成外部请求 | `1057-1069` | 本地 HTTP 服务的状态与 Token 由主进程持有（`electron/stageApi.cjs:245-257,313`） |
| 自动化混音 | `runBeatThis`、`separateStems`、`getBeatThisGpuWeights`、`getAutomixModelsPresent` | `782-856` | 分析工作线程里的 CPU/GPU 兜底路径；权重不在时回 `null` |
| 调试 | `debugGetState`/`debugSetState`、`debugOpenLogs`、内存采样 | `836-845` | `debugRendererMemory` 在 preload 内本地执行，不走 IPC（`preload.cjs:59-72`） |
| mods | 20 个函数（RPC、存储、密钥、网络、选文件、导出进度等） | `1070-1096` | 第三方 mod 的权限面；凭据由主进程保管（`invokeModSecrets`），渲染进程拿不到明文 |

## 7. 信任边界：谁能调哪条通道

- **第一方窗口**：主窗口与远程控制窗口。判定函数 `isTrustedMainWindowContents` / `isTrustedRemoteControlContents`，两个都信的只有酷狗桥（`main.cjs:6829-6844`）。`window.open` 出来的窗口带着同一个 preload，但 sender 不是这两个之一，所以被拒 —— 这正是 `createSenderGuardedHandler` 存在的理由（`electron/ipcAccessGuard.cjs:8-12`）。
- **默认按窗口收窄**：只信主窗口的通道包括 GPU 偏好、壁纸显示选择、点击穿透、常驻置顶、设备像素比、波点/汽水/YouTube Music/Spotify 的请求桥（`main.cjs:6251-6318`、`6845-6873`）。
- **边界要说清**：sender 校验挡得住别的窗口，**挡不住主窗口里已经被注入的脚本**（那时 sender 就是主窗口本身）。防线是 CSP、preload 的收窄暴露面，以及下面的写入白名单。
- **设置写入白名单**：`save-settings` 对 AI 凭据键只接受字符串（`''` 是显式清除），对密文键/派生键直接忽略；`electron-store` 的「对象批量写」入口也被挡掉（`main.cjs:6329-6344`）。
- **外部链接**：`openExternalUrl` 只接受 `http:`/`https:`，其它协议（`file:`、`ms-settings:`、`javascript:`、自定义协议）一律拒绝并回 `false`（`electron/externalUrlPolicy.cjs:14-37`；行为由 `test/unit/electron/ipcSecurity.test.ts:33-96` 钉住）。
- **本地 HTTP 出口不在本文**：舞台服务、歌词 API、OBS 浏览器源是主进程起的本地 HTTP 服务，它们自己的鉴权（Token / 仅 127.0.0.1）见各自模块（`electron/stageApi.cjs`、`electron/lyricApi.cjs`、OBS 相关段落）。

## 8. 改这个契约要动哪些地方

1. `electron/preload.cjs`：加成员（`invoke` 或事件订阅），事件订阅必须返回取消函数。
2. `electron/main.cjs` 或对应的 `electron/**` 模块：加 `ipcMain.handle`/`on`，并在能泄漏权限的通道上套 `createSenderGuardedHandler` 或手写 sender 判断。
3. `src/vite-env.d.ts`：在 `Window['electron']` 里加类型；网页版没有它，所以新成员要可选。
4. 测试：涉及外部链接或发送方信任的，扩 `test/unit/electron/ipcSecurity.test.ts`；其余按域加 `test/unit/**`。
5. 更新本文档与 [secrets.md](secrets.md)（若新通道会接触到凭据）。

## 9. 已知边界与风险

- 两个第一方窗口共享同一份 preload 暴露面，权限差异靠每条通道各自的 sender 判断维持；漏判一条就等于把能力给了远程控制窗口。新通道没有明显的「只属于哪个窗口」时，默认只信主窗口。
- `mods` 子命名空间是第三方代码的入口：它能触发网络、文件选择、存储与密钥操作，能力边界在主进程（`electron/modSystem/`），渲染进程侧没有额外限制。
- 渲染进程里保存的凭据、以及哪些值不许越过这条边界，见 [secrets.md](secrets.md)。
