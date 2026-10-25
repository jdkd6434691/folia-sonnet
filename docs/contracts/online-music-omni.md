# 在线音乐 omni 能力契约

`src/services/onlineMusic/omni.ts` 是普通在线歌曲数据的**唯一公开入口**：搜索、播放地址、歌词、歌单、账户、跨平台解析都从这里进（`omni.ts:79-80`；`AGENTS.md`「在线歌曲只走 omni」）。各平台的请求细节、上游库、接入步骤不在这里抄 —— 见 [`src/services/onlineMusic/README.md`](../../src/services/onlineMusic/README.md)（分层图、接入新平台、汽水与各平台能力）与 [`UPSTREAMS.md`](../../src/services/onlineMusic/UPSTREAMS.md)（每个平台靠哪个库、版本钉在哪）。

本文只写：**omni 对调用方保证什么、各平台必须实现什么、坏了怎么表达。**

## 1. 不变式

1. 界面、hook、store、普通 app service 只能 import `omni`；不得直接 import `providerRegistry`、`*Provider.ts`、`*Transport.ts`、`netease/netease`。这条由 `test/unit/onlineMusic/omniArchitecture.test.ts:10,21-29` 强制。
2. 平台清单只有一处：`providerRegistry.ts` 的 8 次 `registerOnlineMusicProvider`（`providerRegistry.ts:116-123`）。加平台只动自己的目录和这里。
3. 一个平台的规则留在那个平台的目录里；平台目录之外提到平台名的行数由 `test/unit/onlineMusic/platformNamePlaces.ts` 登记、`omniArchitecture.test.ts:45-58` 核对。
4. 能力由平台的 `capabilities` 声明，界面只看开关；没实现的能力通过 omni 得到「空值」或 `OnlineProviderError('unsupported')`，不另开旁路。

## 2. 调用方契约（所有调用都成立）

| 约定 | 说明 | 依据 |
| --- | --- | --- |
| 当前平台 | 不传 `providerId` 的方法作用于「当前平台」：从账户 store 读，平台不存在时退回 `netease` | `omni.ts:135-141` |
| 切平台 | 读当前平台的方法在平台切换事务开始后作废：结果回来时若平台变了，抛 `DOMException('Active online provider changed','AbortError')` | `omni.ts:482-493` |
| 显式平台 | 带 `providerId` 参数的方法（`getProviderHomeFeed`、`getProviderUserAlbums`、`getSongDetail`、`getSongDetails`…）不受切换作废影响 | `omni.ts:873-882`、`923-970` |
| 分页 | `OmniPage<T> = { items: T[]; total?: number; hasMore: boolean; nextOffset: number }`；能力缺失时回 `{ items: [], hasMore: false, nextOffset: 传入的 offset }`（不是抛错） | `types/onlineMusic.ts:122-127`、`omni.ts:227`、`715-717`、`1104-1114` |
| 能力缺失 | 读类能力缺失回空数组/空页/空串；写类与「必须有」的能力缺失抛 `OnlineProviderError('unsupported')` | `omni.ts:191-193`、`1145-1169` |
| 失败描述 | 取音频/读集合失败时，平台的 `describeFailure` 把平台事实挂到错误上再原样抛出；平台自己的报错不被吞 | `omni.ts:211-225`；分类表 `src/services/onlineMusic/failure/onlineFailureCase.ts` |
| 歌词/登录失败同理 | `noteLoginFailure` + `describeLoginFailure`，错误照旧上抛 | `omni.ts:195-209` |
| 批量查歌 | `getSongDetails` 逐条给出 `{status:'found'|'missing'|'failed'|'skipped'}`；只有「平台不存在」才整体拒绝 | `omni.ts:927-970`；`types/onlineMusic.ts:1017-1030` |

## 3. 数据形状

- 每首歌必须是 `UnifiedSong`，并且带 `sourceRef: { kind:'online', providerId, mediaId }`；每个集合带 `providerId`。没有 `sourceRef` 也没有 `providerId` 的歌会被当成网易云的（`src/utils/appPlaybackGuards.ts` 的 `getPlaybackSourceRef`；接入清单第 3 条在 `src/services/onlineMusic/README.md`）。
- `MediaId = string | number`（`types/onlineMusic.ts:6`）；同一个平台对内外 id 不一致时两种都收，由平台自己收窄（`types/onlineMusic.ts:434-446` 的 `getSongDetail` 注释）。
- 集合：`OmniCollection = ProviderCollection`，`type` 取 `'playlist' | 'album' | 'artist' | 'radio' | 'cloud'`（或 mod 自定义字符串）；`isLiked` 表示「我喜欢」，`isOwned` 表示自己的（订阅判断也看它们，`omni.ts:811-825`）。
- 归一化：每首歌先过平台自己的 `normalizeSong(raw)` 再回给调用方（`types/onlineMusic.ts:963-967`）。调用方不要期望平台原始字段。
- 名字/封面/时长等元数据从 `songMetadata` 读，不直接读平台字段（`types/onlineMusic.ts:508-510`）。

（下文 `types:` 均指 `src/types/onlineMusic.ts`。）

## 4. 能力开关（`ProviderCapabilities`）

`types/onlineMusic.ts:51-87`。开关必须和「实现了哪些成员」一致 —— 界面很多地方只看开关（`src/services/onlineMusic/README.md` 的接入第 2 条）。

| 开关 | 含义 | 对应的 omni 面 |
| --- | --- | --- |
| `search` / `playback` / `lyrics` / `auth` / `userLibrary` / `playlists` / `albums` / `artists` / `recommendations` / `mutations` / `wordByWordLyrics` | 基础能力 | `provider.search`、`playback`、`lyrics`、`auth`、`library`、`catalog`、`recommendations`、`mutations` |
| `likes` / `userAlbums` / `userCloud` / `playlistSubscription` / `playlistTrackMutations` / `historyRecommendations` / `personalFmModes` | 可选的账户与写能力 | 由 `omni` 的 `can*` 系列判断（见 §8） |
| `playbackReports` | 接受真实播放上报 | `canReportPlayback` / `reportPlayback`（`omni.ts:1054-1064`） |
| `passwordLogin` / `passwordLoginServerUrl` | 用户名密码登录、表单要填服务器地址 | `omni.loginWithPassword`、`LoginMethod.passwordField`（`types:521-534,630-641`） |
| `explore` | 平台自己的推荐页 | `getExploreFeed` / `getExploreSectionItems`（`omni.ts:913-921`） |
| `songDetail` | 能按 id 查单曲 | 缺省视作 `playback` 在就有（`types:82-86`） |

运行时可用性另有一套：`ProviderAvailability.configured` 说「这个运行环境够不够得着这个平台」，`canSignIn` 只说「能不能开始一次新登录」（`types:89-104`）—— 两者混用会把已登录的用户锁在门外。

## 5. 播放契约

| 项 | 契约 | 依据 |
| --- | --- | --- |
| 取地址 | `getAudioSource(song, quality)` 回 `OmniAudioSource \| null`；`null` 表示没有地址也没话说，抛错表示知道原因（平台 `describeFailure` 负责翻译） | `omni.ts:989-1025` |
| 音质 | 调用方传的是**用户偏好**；omni 按平台声明过的档位换算成最近的不高于它的档，再问平台。平台不声明档位时按 standard/high/lossless/hires 四档 | `omni.ts:86-101`、`979-987` |
| 平台实际给的档 | 以 `source.quality` 为准；omni 记住「这次用哪个档要的」供媒体缓存按 URL 查询 | `omni.ts:1007-1021`、`1027-1031` |
| 试听片段 | `source.preview` 表示这是试听，`clipStartMs` 是片段在歌里的起点；播放与媒体缓存按 URL 询问，不把试听存成整首 | `types:129-147`、`omni.ts:1033-1049` |
| ReplayGain | 平台给就异步落盘（只在这一刻会发生） | `omni.ts:1002-1006` |
| 扩展层 | Folium 的 omni hook 可以在平台答案之后改 URL / 改歌词；被 hook 换过的 URL 记为未知档位、不算试听 | `omni.ts:995-1024`、`1066-1081` |
| 可用性 | `getSongAvailability` 只表达平台**声明过**的事实：`unavailable` 只能配 `taken-down`，权限/付费/地区只能是 `unknown + restricted`；运行时失败永不回写 | `types:149-167`、`omni.ts:1093-1095` |
| 替换 | `getSongReplacement` 找可替代的版本，失败按「取音频失败」描述 | `omni.ts:1097-1102` |
| 上报 | 只有声明了 `playbackReports` 且 `canReport` 认可这首歌才报；单位是「真正渲染的秒数」，不是进度条位置 | `types:478-499`、`omni.ts:1051-1064` |
| 平台自留缓存 | 平台可以管自己的音频缓存（Spotify 那类加密文件）：`keepsOwnSongAudio` / `hasProviderKeptSongAudio` / `keepProviderSongAudio`；失败一律当「没有」 | `providerRegistry.ts:83-101` |

## 6. 歌词契约

- `getLyrics(song, { userId?, extensionHooks? })` 回 `OmniLyricsResult`（`types:174-182`）：
  `{ lyrics: LyricData | null; mainText?; wordByWordText?; translationText?; romanizationText?; isPureMusic: boolean; chorusRanges?: { startTime, endTime }[] }`。
- omni 负责补 `userId`、解析副歌区间，然后才交给扩展层；`extensionHooks: false` 给「扩展层自己」用，拿平台原样结果，避免自己调自己（`omni.ts:1066-1081`）。
- 平台缺 `lyrics` 能力 → `unsupported`（`omni.ts:1070`）。逐字歌词能力看 `capabilities.wordByWordLyrics`。
- 歌手别名、副歌单读是可选能力：`getAlternateArtistName` 回 `null` 表示不知道（`omni.ts:1083-1091`）。

## 7. 账户与登录契约

- 登录状态机：`LoginState = waiting | scanned | confirmed | expired | error`；失败可带 `failure: LoginFailureDetail`（码、原话、HTTP 状态、等多久、或直接点名 `LoginCaseId`），网络层暂时答不上来标 `transient`（`types:246-292`）。
- 登录形态由平台声明：`LoginMethod[]`（可选多方式、可带密码表单）+ `startLogin` + `createQr` 或 `openLoginPage` + `checkLogin` + `cancelLogin`（幂等）。诊断行只能由 `loginDiagnosticReport.ts` 的 `diagnosticLine` 造，报告里不含凭据/IP/账号（`types:643-731`）。
- omni 的入口：`resolveLoginMethods`、`startLogin`、`checkLogin`、`cancelLogin`、`confirmsLoginInBrowser`、`opensLoginPageItself`、`getLoginTtlMs`、`getLoginDiagnostics`、`runLoginSelfCheck`（`omni.ts:629-713`）。诊断接口自己不再失败：平台抛错就写一行进报告。
- 账户读取：`readAccount(providerId, reason)`、`signOutAccount`、`refreshProviderPlaylists`、`accountMoment`、`songsInPlay`。`readAccount`、`signOutAccount` 与 `accountMoment` 按注释保证**永不拒绝**（失败写在 `AccountReadOutcome` 里）；`refreshProviderPlaylists` 读不到时会拒绝（`omni.ts:719-738`、`1294-1311`）。
- 喜欢的歌：读整份时用 `beginLikedListRead` / `endLikedListRead(read, songs, whole)`。`whole=false` 表示平台自己截断了、或分页没读完 —— 这时只加心、不摘心，播放中的歌另外核对（`omni.ts:1258-1287`；规则在 `account/keptAfterRead.ts`）。

## 8. 写操作契约

- 能不能写先问 `can*`，不要自己拼条件：`canLikeSong`、`canAddSongToPlaylist`、`canCreatePlaylistForSong`、`canEditCollectionTracks`、`canSubscribeCollection`、`canDislikeSong`、`canDislikeCollectionSongs`（`omni.ts:740-825`）。这些函数把三件事一起看了：`capabilities` 开关、实现成员在不在、平台自己的 `can*` 钩子。
- 红心是**先变后发**：`pressSongLike` 返回 `LikePress`，界面立刻变，`settled` 永不拒绝；失败时心形回到账户实际状态。要等到结果的用 `likeSong`，它会拒绝，包括「被另一次按压改回去了」这种情况（`omni.ts:1220-1256`）。
- 歌单写入：`addSongToPlaylist` 要求歌与歌单同平台、歌单类型是 playlist、平台支持 `playlistTrackMutations`；写完刷新账户歌单，刷新失败只记日志不把成功变失败（`omni.ts:1188-1218`）。
- 创建歌单：`createPlaylistWithSong` 先建再放歌；放歌失败时会刷新歌单（避免重试建出第二个），错误照旧上抛（`omni.ts:1171-1186`）。
- 订阅/取消订阅、加歌删歌走 `subscribe` / `updateCollectionTracks`；能力不满足抛 `unsupported`（`omni.ts:1145-1169`）。
- 「不喜欢」只有平台自己有这个推荐能力时才提供，替换结果由平台给（`omni.ts:1313-1319`）。

## 9. 错误模型

- 统一错误类 `OnlineProviderError`（对外别名 `OmniError`）：`code` + `message` + `providerId?` + `cause?` + `httpStatus?` + `retryAfterMs?` + `details?`（`types:400-416`、`1008`）。
- `code` 取值见 `types:324-357`。几个容易误用的：`unsupported`（这个平台/后端没有这项能力）、`not-public`（集合不公开，别混进 unsupported）、`unavailable`（平台或服务没接住，**从不表示下架**）、`not-playable`（答了但没给音频，原因不明）、`taken-down`（当前内置平台都没有经核实的信号）、`web-login-required`（被前面一层网关要求网页登录）。
- `details.attempts` / `details.stage` 只给诊断用：界面**不得**按 `stage` 或 `upstreamCode` 分支（`types:362-397`）。
- 平台把事实翻译成「情况」：`describeFailure(operation, error)` / `describeLoginFailure(step, error)` 只补事实、不再抛；分类在 `failure/onlineFailureCase.ts` 与 `login/loginFailureCase.ts`，文案在各自的 `*Texts.ts`。

## 10. 注册表契约

| 项 | 契约 | 依据 |
| --- | --- | --- |
| 注册 | `registerOnlineMusicProvider(provider)`，以 `provider.id` 为键，重复注册会覆盖 | `providerRegistry.ts:35-38` |
| 注销 | `unregisterOnlineMusicProvider(id)`，返回是否真的删掉 | `providerRegistry.ts:40-43` |
| 变化通知 | 每次注册/注销 `registryVersion` +1，`subscribeOnlineMusicProviderRegistry(listener)` 返回取消函数；UI 用它发现「平台列表变了」（Folium mod 会动态加平台） | `providerRegistry.ts:27-53` |
| 查询 | `getOnlineMusicProvider` 不存在回 `null`；`requireOnlineMusicProvider` 不存在抛 `OnlineProviderError('unavailable')` | `providerRegistry.ts:55-67` |
| 按歌找平台 | `getOnlineMusicProviderForSong` 只看 `sourceRef`；不是在线歌回 `null` | `providerRegistry.ts:74-77` |
| 单注册 | 汽水有两套实现，**只能注册一份**（否则同 id 互相盖掉） | `providerRegistry.ts:16-22` |
| 目录名 | 平台目录名 = 注册 id；桌面端 `electron/<id>/` 同理 | `AGENTS.md`「目录」；`src/services/onlineMusic/README.md` 接入第 1 条 |

## 11. 平台原始接口与探索页

- 原始接口是「平台专有能力的后备通道」，只给 Folium 的 `platform.raw` 用：平台用 `describeEndpoint` 维护分类表（`read`/`write`/`denied`），`reservedParams` 由宿主自己填；omni 再挡一次表外/拒绝/非法参数，并把回答里的凭据字段剥掉（`types:909-943`、`omni.ts:1351-1403`）。有对应 omni 能力的接口，调用方必须改用 omni。
- 探索页：`getExploreFeed(cursor?, listened?)` / `getExploreSectionItems(cursor)` 的游标语义、`refreshReadsAnew`、`changesWithRead` 见 `types:807-879` 与 `EXPLORE_ADAPTER.md`，不在本文重复。

## 12. 加能力或加平台时要动的地方

按 `src/services/onlineMusic/README.md` 的「接入一个新平台」办，这里只列**契约侧**必须同步的：

1. `src/types/onlineMusic.ts`：新数据形状 + 契约注释（语义写进注释，不写进调用方）。
2. `omni.ts`：新方法（或扩已有方法），能力缺失时按 §2 的规则回空/抛 `unsupported`；同时补 `can*` 开关。
3. 各平台实现；`capabilities` 必须与实际实现一致。
4. `providerRegistry.ts`：新平台在这里注册（只动注册点 + 自己目录）。
5. 测试：`test/unit/onlineMusic/` 的行为用例；平台名出现处登记到 `platformNamePlaces.ts`；架构测试的禁止 import 列表加新 transport（`omniArchitecture.test.ts:10`）。

## 13. 已知边界

- `omni` 是单例对象（`omni.ts:495`）；「当前平台」是全局状态，并发切换靠作废（§2）而不是锁。
- 能力开关与实现不一致时，失败是运行时的 `unsupported` 或空值，不会有编译期错误；加能力时按 §4 逐项核对。
- 平台之间的同名不同义字段不在这里统一（例如「收藏」在有的平台是订阅、有的是红心）；统一发生在 omni 的方法语义里，不发生在类型别名上。
