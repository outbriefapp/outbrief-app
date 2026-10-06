# outbrief-app

OutBrief 客户端（Tauri 2 + React 19 + TypeScript）：AI Agent 完成任务后，像微信视频来电一样响铃；接听后以语音 + 卡片汇报，可随时打字打断，挂断时回复原会话。

- 服务端：[`outbrief-server`](https://github.com/outbriefapp/outbrief-server)（方案文档与 ADR 也在那里）
- 本机常驻进程与 Agent 回调：[`outbrief-daemon`](https://github.com/outbriefapp/outbrief-daemon)

## 目录

| 路径 | 内容 |
|---|---|
| `src/callQueue.ts` | 来电 / 排队 / 挂断状态机：汇报先「准备中」，整份语音生成好才响铃；生成失败的不响铃，在空闲页可重试 / 忽略。排队的汇报按来电页的顺序响铃（先 issue 优先级，再更新时间），还没上屏的队首会让给更紧急的汇报；没上屏的汇报都是「未接来电」，可以在来电页任选一个直接接听。不在响铃时段收到的汇报（包括 App 没开时在不响铃时段里收到的）、以及进入不响铃时段时还没接的汇报，记为未接，之后回到响铃时段也不会自己响铃，只能在来电页接听或「全部知悉」（纯函数，有单测） |
| `src/callModes.ts`、`src/useRingSchedule.ts` | 模式：名字 + 时段 + 重复（周几用），规则是「只在这些时段响铃」或「这些时段不响铃」（时段可跨夜，如 22:00–08:00）。可以同时打开多个模式，只要重复不在同一天；每天按当天的模式算（0:00–24:00），没有模式的日子随时响铃；算出现在能不能响铃、什么时候变（最多往后看一周，有单测） |
| `src/components/ModesPage.tsx` | 设置 → 模式，照着闹钟做：列表每行大字显示时段，下面写「名称 · 重复 · 规则」，右边一个开关，开关立即生效。重复不在同一天的模式可以一起打开（例如工作日一个、周末一个）；打开一个模式会关掉和它同一天的模式，并提示关了哪个。右上角「+」新建，点一行进编辑页：开始 / 结束时间用滚轮选（`react-mobile-picker`，可滚动、拖动或点数字），可以加多个时段；「重复」点选周一到周日（默认每天）；规则是「时段内响铃 / 时段内不响铃」；再填名称，「存储」保存，底部「删除模式」。首次安装带「工作」（工作日 10:00–19:00 响铃）和「睡眠」（每天 22:00–08:00 不响铃），都不打开，即「随时响铃」。旧版本存的模式按每天用，原来选中的模式保持打开 |
| `src/ringtones.ts`、`src/ringtoneStore.ts`、`src/useRingtone.ts`、`src/components/RingtonesPage.tsx` | 设置 → 通话 → 铃声（YOUT-228），照着手机的「电话铃声」做成两层：第一层只有「来电铃声」「呼叫等待铃声」两行，右边是现在用的铃声；点进去是这一项自己的页面。来电铃声默认「经典」（原来的铃声）；呼叫等待铃声在呼叫 Agent 后「呼叫中」一直放，直到 issue 建好、失败或取消，默认「回铃音」（450 Hz 响 1 秒停 4 秒），也可以「不响」。每一项的页面：顶部固定显示当前铃声（可试听），铃声超过 8 个出现搜索框；「我的铃声」第一行是「添加铃声…」（任意音频文件，可以一次选多个，每个最大 10 MB，音频存在这台设备的 IndexedDB `outbrief-ringtones`），在哪一项添加就直接用作哪一项；新加的在前，只显示前 5 个，其余点「显示全部」；被另一项在用的标「来电铃声在用 / 等待铃声在用」；下面是 6 个内置铃声（`public/ringtones/`）。点一个会试听一遍并选中。右上角「编辑」可以直接改名、勾选多个一起删；删正在用的会先确认，那一项回到默认（有单测） |
| `src/call/prepare.ts` | 来电前在客户端把简报的每一句都合成好，放进语音缓存；通话中直接从缓存播放（有单测） |
| `src/call/session.ts` | 通话中状态机：分段 / 逐句播放位置、打断、跳页、问答、决策、挂断（纯函数，有单测） |
| `src/call/useCall.ts`、`src/call/player.ts` | 通话副作用：逐句合成 + 预取播放、流式回答边收边读 |
| `src/llm/providers.ts`、`src/llm/endpoint.ts`、`src/components/LlmSettingsSection.tsx` | 设置 → 大模型：服务商预设、接口地址规整、`GET /models` 取模型列表、测试连接（结构化输出，和 daemon 生成简报同一种调用）；保存时同步给本机 daemon（有单测） |
| `src/llm/qa.ts` | 通话中提问：客户端用 AI SDK（`ai` + `@ai-sdk/openai-compatible`）直接流式请求用户自己的兼容 OpenAI 接口，提示词带上汇报全文（不截断）、简报、已听进度和对话历史（有单测）。Tauri 里走 `@tauri-apps/plugin-http` 的 fetch（接口不给 webview 发 CORS 头），浏览器 `pnpm dev` 里用普通 fetch |
| `src/call/resume.ts` | 回到原 Agent 会话的命令（`claude --resume` / `codex resume`，有单测） |
| `src/call/answered.ts` | 一通电话在一台设备上只响一次（YOUT-226）：服务端在通话结束前一直把它当待接，App 重启或页面刷新后会再推一次。已经在本机结束的（历史里有）不再出现，把结果重新报给服务端（上次可能没报上）；接听过、通话被重启打断的放进未接来电，不再响铃。接听过的 id 记在 `outbrief.answered`（最多 200 个，有单测） |
| `src/call/records.ts` | 本机历史记录 `outbrief.call.<eventId>`（最多 100 条，存储满了先删最旧的）：来电结束时把整个事件（汇报、简报）连同通话对话、决策、发出的回复存下来；之后收到的投递状态只合并状态字段。服务端来电结束就擦掉汇报和简报，不保存历史（有单测） |
| `src/voice/` | TTS / STT、录音、分句（见该目录）。语音只从本机直接请求用户选的语音平台（`tts/`），没有服务端兜底：服务端不能看到简报的明文 |
| `src/voice/tts/` | 语音平台（设置 → 语音）：`types.ts` 是引擎接口，`registry.ts` 是注册表（加一个平台 = `engines/` 下加一个模块 + 注册表加一行，其他代码不认识具体平台），`engines/` 是 12 个内置平台，`template.ts` 是自定义 HTTP 请求模板、`curl.ts` 解析 cURL 并自动认出句子 / 音色 / 语速的位置、`audio.ts` 解析各家的返回（裸音频 / JSON 里的 base64、hex、URL / 逐行 JSON / 裸 PCM 加 WAV 头），`settings.ts` 存每个平台各自的配置（均有单测） |
| `src/voice/languages.ts`、`src/voice/voices.ts`、`src/voice/azureVoices.ts`、`src/voice/phrases.ts`、`src/useSpeechLanguage.ts` | 设置 → 语音的**汇报语言**：语速（0.5×–2×）由各平台的接口范围再夹一次，接口没有语速参数的平台（Gemini、Qwen-TTS、ChatTTS、CosyVoice）会在页面上说明语速对它无效。汇报语言照搬 youtube-dubbing-extension 插件端的目标语言：它的语言表里有 Azure 声音的 90 个 locale（名称也用插件的，如「美国(英语)」「中国台湾」），默认跟随系统（系统首选语言按「语言-地区」匹配，没有就取该语言最常用的地区，如 `pt` → `pt-BR`，都没有用 `en-US`）。`azureVoices.ts` 由插件的 `AzureVoiceMap` / `VoiceCodeLabelMap` 生成，每个语言的声音和插件一样，按女声 / 男声分组（去掉 path B 返回 400 的 DragonHD 声音和已下线的晓萱），当前语言的声音显示本语言名、其他语言的多语言声音显示英文名；多语言声音用于别的 locale 时 SSML 加 `<lang xml:lang>`（和插件的 EdgeTtsSsmlBuilder 一样）。本机 daemon 用汇报语言写简报（App 启动和切换时 `PUT http://127.0.0.1:8790/brief/language`，daemon 没运行就每 30 秒重试，被拒绝（例如密钥不一致）不重试；没有本机 daemon 时经服务端加密转发给「设置 → 大模型 / Multica」里选的电脑），来电念的内容、没有简报时那句提示和试听（`phrases.ts`，74 种语言）、通话中的回答也都用它。存的声音不属于当前语言时用该语言的第一个女声，切回原来的语言时恢复（有单测） |
| `src/sse.ts`、`src/serverClient.ts` | SSE 订阅（`Last-Event-ID` 续传）、回复、状态回写，以及账号 / 设备 / 配对码接口。设备令牌被拒（401，这台设备在别处被移除了）时停止重连，回到欢迎页 |
| `src/account.ts`、`src/pairing.ts`、`src/components/WelcomeScreen.tsx`、`src/components/DevicesPage.tsx`、`src/components/JoinForm.tsx` | 匿名账号和设备配对（outbrief-server ADR 0008），见下文「账号和设备」（有单测） |
| `src/daemonLink.ts`、`src/useDaemon.ts` | 改 outbrief-daemon 设置（Multica、简报大模型、汇报语言）的两条路：本机 daemon（`127.0.0.1:8790`，用 `~/.outbrief/local-api.key` 鉴权，Tauri 的 `read_daemon_local_key` 读文件）；没有本机 daemon 时（手机）用端到端密钥加密后经服务端 `POST /v1/devices/<电脑>/settings` 转给账号下的电脑（有单测） |
| `src/settings.ts` | 本地设置 `outbrief.settings`：服务地址和这台设备的账号（设备令牌 `oba_…`、账号 id、设备 id；旧版本存的共享口令会被丢弃）、汇报语言、声音类型、声音、语速、称呼、大模型（接口地址 / API Key / 模型）、端到端密钥（`e2eKey`，以及是否跟随本机 daemon），全部只存在本机。没有登录 |
| `src/components/` | 空闲 / 来电 / 通话中 / 挂断回复 / 来电列表（只读本机记录）/ 设置界面 |
| `src/callList.ts`、`src/components/HistoryScreen.tsx` | 「来电」页：上面是未接来电（在排队、还没接的汇报，例如睡眠模式里攒下的），每行点「接听」直接接通，不用按顺序一个个来；下面是本机通话记录。未接来电标题右边有「全部知悉」：当前页签里的未接来电都知道了、不再接听，一起记为「已知悉」进通话记录（服务端状态 `acknowledged`）。每一行都写来电时间，精确到秒（`2026-09-29 14:05:33`），鼠标悬停看 issue 更新时间。按项目分页签（只有 Multica issue 所属的项目才有页签；本机 Agent 的汇报、不在项目里的 issue 不算项目，目录名、汇报标题都不当项目名），外加「全部」：「全部」里两个列表都按项目分组、组名只写项目名，不属于任何项目的来电放在最后的「其他」组里。每个列表先按 issue 优先级（紧急 → 高 → 中 → 低 → 无），同优先级按 issue 更新时间倒序。打开时经本机 daemon（`POST /multica/issues`）从 Multica 刷新通话记录的优先级、更新时间和项目并存回记录（有单测） |
| `src/components/ProjectTabs.tsx`、`src/tabsFit.ts` | 项目页签只占一行：触屏上用手指左右滑；用鼠标时放不下的页签收进行尾的「更多」菜单（有未接来电时显示红色数字），当前页签始终留在行里（`fitTabs` 有单测） |
| `src/i18n/` | 界面语言（设置 → 界面语言）：跟随系统（系统首选语言是中文就用中文，否则英文）/ 中文 / English。`zh.ts`、`en.ts` 是两套完整文案，类型保证 key 一致；中文下产品名是「启奏」，英文下仍是「OutBrief」。组件用 `useT()`（切换语言立即重绘），组件外的报错、描述文字用 `t()`。窗口标题、托盘提示、托盘菜单和 macOS 菜单栏（编辑 / 窗口等）由 `src/shell.ts` 调 Rust 的 `localize_shell` 跟着改。菜单栏最左边的粗体 App 名是 macOS 在启动时从 bundle 的 `CFBundleName` 读的，运行中改不了：`localize_shell` 把当前语言的名字记进 App 的 user defaults（`OutBriefAppName`），下次启动前写进 bundle，所以切换语言后重开一次 App 才变成「启奏」/「OutBrief」。打包后的 App 另有 `src-tauri/macos/<语言>.lproj/InfoPlist.strings`，Dock、访达里的名字跟随系统语言。只改界面文字：简报、语音、通话中的回答的语言在「设置 → 语音 → 汇报语言」里设（有单测） |
| `src/components/DispatchScreen.tsx`、`src/dispatch.ts`、`src/useDispatchOptions.ts` | 呼叫 Agent（主动派单，YOUT-222）：空闲页正中间状态文字下面的绿色圆形电话按钮进入（这一页唯一要主动做的事，所以放在正中间，不和右上角的「来电」挤在一起、也不再是两个长得很像的电话图标），一页直发：项目和 Agent 默认是这台设备上一次派单用的（`outbrief.dispatch.last`），要换就点开底部面板；在文本框里用手机输入法的语音说需求（优先级、截止日期也一起说），可以附图片（文本框下面的图片按钮选，桌面端也能直接粘贴截图或拖进文本框）：和 Multica 自己的限制一致，张数不限、每张最大 100 MB（Multica 网页端 `MAX_FILE_SIZE` / 服务端 `maxUploadSize`）；超过 1.5 MB、长边超过 2048 或不是 PNG / JPEG / WebP / GIF 的先在本机转成长边 2048 的 JPEG；发送时经 daemon 一张一张传到 Multica（`POST /multica/uploads`），再派单（`src/dispatchImages.ts`，YOUT-226），只发图片也行，「呼叫并派单」后经电脑上的 daemon（`POST /multica/dispatches`）调 Multica 智能创建，由选中的 Agent 写 issue（标题、优先级、截止日期都由它从原话里提取；图片由 daemon 先传到 Multica，放进 issue 描述），「呼叫中」每 3 秒问一次 issue 建好没有，建好后「已派单」显示编号和标题；可以取消，或不等了先去「我的派单」。「我的派单」列出这台电脑派出的所有单（记在电脑上，同一账号的设备都能看到）和 issue 现在的状态。项目、Agent 每 10 秒经 daemon 重读一次：电脑离线、本机 daemon 没运行、电脑上没设 Multica、选中的 Agent 所在电脑在 Multica 里不在线时，按钮禁用并写明原因，恢复后自动能派（`src/dispatch.ts` 有单测） |
| `src/components/SettingsForm.tsx` | 设置首页是分组列表（通用 / 连接 / 个人 / 集成 / 通话），每一行点进去是单独的一页，各自保存；以后加设置项就加一行 |
| `src/components/MulticaSettingsSection.tsx` | 设置 → Multica：填自己的 Multica API Token → 验证 → 选工作区 → 保存。首次安装为空，不带任何默认令牌。令牌只存在电脑上的 outbrief-daemon（桌面端直接请求本机 `http://127.0.0.1:8790/multica/*`，用本机密钥文件鉴权；手机经服务端加密转发给账号下的电脑，服务端读不到），不以明文经过服务端；之后只显示 `mul_…xxxx`。daemon 用它监听 Multica 任务、发挂断后的回复，电脑关机时 Multica 任务不会来电 |
| `src/addressName.ts` | 设置 → 称呼（默认「老板」）：简报里用 `{称呼}` 占位，客户端收到来电 / 读历史时替换成自己的称呼；通话中提问时也按这个称呼回答 |
| `src/protocol.ts` | `outbrief-server` `src/protocol.ts` 的镜像类型，改接口时一起改。服务端转发的是密文 `RelayedEvent`，App 里用的是解密后的 `AgentEvent` |
| `src/e2e/` | 端到端加密（outbrief-server ADR 0007）：`crypto.ts` 用 WebCrypto 实现 AES-256-GCM，以及从用户设的密钥（一句话）派生出真正的 `obk1_` 密钥，和 outbrief-daemon 用同一组测试向量；`events.ts` 解密来电和失败原因、加密回复；`useE2eKey.ts` 有本机 daemon 时跟随它的密钥（`GET http://127.0.0.1:8790/e2e/key`，本机密钥文件鉴权）（均有单测） |
| `src/components/E2eSettingsSection.tsx` | 设置 → 加密：只有一句提示（在这里可以换一个新的密钥，请确保和电脑端的密钥保持一致）和一个「密钥」输入框：用户填一句至少 12 个字符的话，App 用它算出真正的 `obk1_…` 密钥（`keyFromPassphrase`），本机 daemon 在线时一起换掉。算出来的密钥和它的 `keyId` 都是内部细节，界面上不显示 |
| `src-tauri/` | Rust 壳：托盘（显示窗口 / 退出，关窗口只隐藏）；`tauri-plugin-http` 供通话中提问请求大模型，`capabilities/default.json` 放行任意 `http://*:*` / `https://*:*`（接口地址由用户填，端口不固定） |

## 通话里怎么用

- 空闲页右上角是「来电」和「设置」两个图标（`lucide-react`），界面里不写产品名（macOS 窗口标题栏也不显示，`hiddenTitle`；调度中心和「窗口」菜单里仍叫「启奏」），也不显示服务地址（在「设置 → 设备」里看）。页面正中间状态文字下面是一个绿色圆形电话按钮（主动派单）。
- 空闲页左上角是今天的模式（`src/components/ModeMenu.tsx`），做法参考手机的专注模式、聊天软件的免打扰：一个小胶囊显示铃铛和模式名，现在不响铃时铃铛带斜线、胶囊变成琥珀色。点开是菜单：先写现在响不响铃、几点变，下面单选「随时响铃」或今天能用的模式（选中的打勾，会关掉原来今天那个模式），最后一行「管理模式…」直接进「设置 → 模式」。
- Multica 来电在来电页、通话顶栏显示 issue 所属的项目名（issue 不在任何项目里就不显示）。
- 汇报到达后先在本机把整份简报的语音全部生成好，才开始来电；接听后不用等合成。空闲页显示「正在生成 N 个汇报的语音」。某份汇报的语音生成失败时不来电，空闲页列出失败原因，可「重试」（重新生成，好了就来电）或「忽略」（记为已拒绝）。
- 模式：空闲页左上角的模式菜单里可以直接换成今天能用的其他模式或「随时响铃」，并显示现在响不响铃、几点变（不是今天时写「明天」或「周几」）。不在响铃时段里收到的汇报不响铃、不弹窗，记为未接来电；回到响铃时段也不会自己弹出来。空闲页右上角的来电图标上有红色数字（未接来电数），点它进来电页，自己挑着接听，不想接的点「全部知悉」。通话中进入不响铃时段不会打断通话，挂断后排在后面的汇报也记为未接。
- 播放中随时打断：直接在输入框打字、点决策选项。输入框默认三行高，文字多了自动变高（有上限）。
- 通话中的对话区是固定高度，消息多了在里面滚动，不会把「暂停 / 挂断」那排按钮挤出屏幕；窗口太矮时先压缩上面的卡片。
- 打字提问后由大模型根据 Agent 的汇报全文和简报回答，边收边读；Multica 来电也一样。给 Agent 的指令、意见会回复「记下了，挂断后发给 Agent」，不会假装已经执行。
- 打「继续」「继续吧」「接着说」「继续播放」直接接着播。
- 回答时再次打断会中止请求和剩余语音；回答失败时气泡里写明原因（例如还没配大模型、接口 401），可点「重试」。
- 挂断后把通话里自己说的话和决策拼成回复，可以编辑再发给 Agent（这一步不调用大模型）。
- 卡片可以左右翻（圆点 / ‹ ›），语音跟着跳到那一段开头。
- 语音平台（本机直连，见「设置 → 语音」）不可用时，来电前会提示生成失败，可重试或忽略；通话中出错时整通电话降级成「卡片 + 文字」，字幕按字数自动翻句。
- 汇报播完后停在当前通话，可以继续提问，或挂断回复；「完成」后自动接下一个来电。

## 账号和设备

没有登录，也没有要填的令牌（outbrief-server ADR 0008）。账号是匿名的，只有一个 id；每台设备有自己的令牌，可以在「设置 → 设备」里逐台移除。来电只发给同一个账号的设备。

- **第一次打开**：桌面端所在的电脑装了 outbrief-daemon 时，自动加入 daemon 的账号（daemon 通过本机 `POST /local/pairing` 给一个配对码和它的密钥），升级前用共享口令的桌面端也是这样换成自己的设备令牌；否则服务端开放注册时自动创建一个账号，什么都不用填。
- **欢迎页**只在不能自动完成时出现：私有化部署的服务端还没有主人（要填服务端日志里的认领码；`pnpm dev:all` 会自动传给桌面端）、服务端已关闭注册、这台设备刚被移除，或者本机 daemon 装了但没在运行（启动后自动加入）。可以改服务地址、创建账号、扫码 / 粘贴配对链接 / 输配对码加入。
- **添加设备**：「设置 → 设备 → 添加设备」显示二维码和 6 位配对码（10 分钟、一次性），新设备加入后提示「xx 已加入」。二维码 / 配对链接 `outbrief://pair?server=…&code=…&key=obk1_…` 带着服务地址和端到端密钥；给电脑用时复制页面上的 `outbrief-daemon login '<链接>'`。
- **加入另一个账号**：同一页里扫码 / 输码加入，这台设备先退出当前账号。
- **扫码**：手机和浏览器用摄像头（`qr-scanner`）；桌面端不扫码，粘贴配对链接。
- **没有 PC 客户端**：手机改 Multica、大模型、汇报语言时，请求用端到端密钥加密后经服务端转给账号下的电脑（有多台时在页面顶部选），服务端读不到。

## 端到端加密

汇报、简报、挂断后的回复都在这台设备和上报汇报的电脑（outbrief-daemon）之间加密，服务端只转发密文，没有密钥。通话中的提问直接请求你自己的大模型，不经过服务端。

- 默认不用设置：桌面端从本机 daemon 拿到它的密钥（本机密钥文件鉴权），存进本地设置（daemon 重启期间也能解密）；App 先装、自己建账号时随机生成一把。
- 别的设备扫「设置 → 设备 → 添加设备」的二维码（或粘贴配对链接）加入时，密钥跟着二维码从设备传到设备，服务端看不到。只输 6 位配对码时要再输一次加密口令。
- 「设置 → 加密」可以自己设一个密钥（一句至少 12 个字符的话，同一句话在每台设备上得到同一把密钥）。本机 daemon 在线时一起换掉；密钥不会经服务端改到别的电脑上。
- 解不开的来电（密钥不一致或被篡改）不响铃，空闲页显示原因，可以「忽略」；不会退回明文。
- 换密钥后，旧密钥加密、还没接听的来电解不开；已经在本机历史里的记录不受影响（本地存的是解密后的内容）。

## 设置 → 语音

汇报的语音全部在这台设备上直接请求你选的语音平台，服务端看不到简报的明文。这一页从上到下是：**汇报语言** → **内置平台 / 自定义接口** → 这个平台需要的配置 → **模型** → **声音** → **语速** → **测试合成**。

- **布局**：和「设置 → 大模型」一致。顶部分成「内置平台 / 自定义接口」两个标签，一次只显示一种；内置平台是一个下拉框（每行平台名和接口域名 / 「免费」「自部署」，可搜索），以后平台再多也不会把下面的 Key、声音挤出屏幕。平台需要的配置项由平台自己声明（Key、地域、服务地址…），页面按声明渲染，加平台不用改界面代码。
- **每个平台各存一份配置**：换平台不会丢掉上一个平台填好的 Key、模型和声音，换回去还在。API Key 只存在这台设备，保存后只显示 `sk-…abcd` 和「更换」按钮。
- **声音**：平台自带的音色按女声 / 男声分组，**显示的是名字**（如「爽快思思（2.0）」「云小和 · 聊天女声 · 超自然大模型」），不是 `zh_female_vv_uranus_bigtts` 这种编码；支持复刻音色的平台（MiniMax、豆包、ElevenLabs 等）点进输入框才显示、可编辑真正的音色 id，能列音色的平台还有「获取音色」按钮，把账号里的复刻 / 设计音色拉下来一起选。
- **音色和语言的关系按各平台文档区分**（都核对过官方文档，有单测锁住）：
  - **按语言分音色**：Azure（每个 locale 各自的声音）、MiniMax（音色 id 自带语言，日语 16 个、韩语 49 个、葡语 73 个…，切换汇报语言就换成该语言的音色，广东话单独一组）。
  - **音色与语言无关**：ElevenLabs（多语言模型任何音色都能读它支持的全部语言，v4 还会去掉参考音的口音）、Grok（官方原话「所有音色都能说每一种支持的语言」）、OpenAI、Gemini、阿里云 Qwen-TTS（每个音色都额外支持英法德俄意西葡日韩）。这些平台的音色列表不随汇报语言变化，语言由请求参数决定。
  - **豆包**：id 分 `zh_` / `en_`，但 2.0（`_uranus_`）音色支持 30+ 语种自动识别，所以合成一个列表。
  - **腾讯云**：音色确实分语言（中英文 / 中文 / 英文 / 粤语），而且 `PrimaryLanguage` 只有中文和英文两种，所以其他语言在这个平台上本来就不合适。
- **语速**：一个 0.5×–2× 的滑块，按各平台接口自己的范围夹一次（ElevenLabs 0.7–1.2、Grok 0.7–1.5、腾讯云按官方的 `Speed` 档位换算）。接口没有语速参数的平台（Gemini、阿里云 Qwen-TTS、ChatTTS、CosyVoice）会在滑块下面写明语速对它无效——不假装能调。
- **测试合成**：用页面上当前的配置直接念一句试听（不用先保存），失败时把接口返回的原因写出来。

### 内置平台

所有接入方式都按各家官方文档核对过（2026-09-29）：

| 平台 | 接口 | 说明 |
|---|---|---|
| Azure | 免费的 translator JWT（path B） | 默认平台，不用配置，90 个语言的声音跟着汇报语言走 |
| ElevenLabs | `POST /v1/text-to-speech/{voice_id}` | `output_format` 在 query 里；音色与语言无关（任何音色能读全部支持的语言），但是账号维度的（Default 音色 2026-12-31 过期、2026 年 3 月后注册的账号没有），所以内置只放官方文档给了 id 的 2 个，其余用「获取音色」拉自己的；Eleven v4 不支持语速 |
| MiniMax | `POST /v1/t2a_v2` | 国内站 / 国际站账号和 Key 各自独立；错误是 HTTP 200 + `base_resp.status_code`；音频是 hex；系统音色按语言分（17 种语言共 275 个，见 `engines/minimaxVoices.ts`） |
| 豆包 | `POST /api/v3/tts/unidirectional/sse` | 新版控制台填 API Key，旧版填 App ID + Access Token；音色决定 resource id（2.0 音色配 1.0 会 45000000），逐帧 base64 拼接 |
| 阿里云百炼 | Qwen3-TTS `multimodal-generation/generation` | 北京 / 新加坡 Key 不通用；返回的是 24 小时有效的音频 URL，再下载一次；接口没有语速参数 |
| 腾讯云 | `TextToVoice`（API 3.0） | TC3-HMAC-SHA256 签名用 WebCrypto 算（签名日期按 UTC）；错误也是 HTTP 200 + `Response.Error`；精品音色只有 16k |
| OpenAI | `POST /v1/audio/speech` | 可以改接口地址走代理或兼容服务 |
| Gemini | `generateContent` + `responseModalities: ["AUDIO"]` | 显式要 `AUDIO_WAV`，免得 3.1 / 2.5 返回没有文件头的 L16 PCM；没有语速参数，只能把快 / 慢写进 `speech_metadata.style` |
| Grok | `POST /v1/tts` | `language` 必填，汇报语言不在它支持的 20 种里就传 `auto` |
| ChatTTS | 自部署，`examples/api/openai_api.py` 的 `/v1/audio/speech` | 官方另一个 `/generate_voice` 返回 zip，所以用这个；它的源码把 `[speed_5]` 写死了，语速无效 |
| IndexTTS | 自部署，vLLM-Omni 的 `/v1/audio/speech` | 仓库自带的 Gradio WebUI 参数是位置相关、版本之间还会变，不作为接口；要用 Gradio 请走「自定义接口」。音色是上传的参考音频 |
| CosyVoice | 自部署，官方 FastAPI `/inference_sft` | 返回的是裸 PCM（`Content-Type` 还是 `text/plain`），采样率要和服务端模型一致（CosyVoice-300M 22050、CosyVoice2/3 24000），WAV 头由 App 加；服务端没透传语速 |

### 自定义接口

不同 TTS 的接口规范差别很大，所以这里不猜格式。但也不让你手填一堆表单——手机上填方法、请求头、请求体太不方便（YOUT-191 评审），**只保留粘贴 cURL 这一种方式**：

- **粘贴 cURL**：把平台文档里的 curl 示例粘进来点「导入」，方法、地址、请求头、请求体一次成型。
- **自动认出占位符**：导入时按各家接口常用的字段名（`text` / `input` / `tts_text`、`voice` / `speaker` / `spk_id`、`speed` / `speech_rate` 等）把示例里的句子、音色、语速换成 `{{text}}` / `{{voice}}` / `{{speed}}`，JSON 的嵌套字段、form 字段、URL 查询参数都能认。数字字段（语速）不加引号，渲染出来仍是数字。
- **认错了点一下就改**：「哪个值是句子 / 音色 / 语速」三行按钮，列出示例里的真实值（如 `req_params.text` → `你好`），当前选中的打勾，点另一个即可换过去——不用在手机键盘上打大括号。
- **会发出的请求**：导入后的请求原样只读显示，要改就重新粘一次 curl，不会藏着发什么。
- **响应**：选「响应体就是音频」或「JSON 里的字段」。选后者再填字段路径（`data.audio`、`candidates.0.content.parts.0.inlineData.data` 这种一层层写），并选字段里是 Base64 音频、Hex 音频还是音频链接（链接会自动下载）。一行一个 JSON 对象的流式响应会按顺序拼起来。
- **音频格式**：mp3、wav、ogg 等带文件头的自动识别；没有文件头的裸 PCM 选「裸 PCM（16 位单声道）」并填采样率，App 自己加 WAV 头。
- 代入时按请求体的 Content-Type 自动转义（JSON 字符串、form、XML/SSML），句子里的引号、换行不会把请求体弄坏。没认出句子、地址不是 http(s)、字段路径没填都会当场提示，不完整的请求不会发出去。

## 设置 → 大模型

通话中提问（在这台设备上直接调用）和电脑端生成简报（本机 outbrief-daemon 调用）用同一个大模型，配置只在这一页：

- **布局**：页面顶部分成「内置服务商 / 自定义接口」两个标签，一次只显示一种；内置服务商是一个下拉框（每行服务商名和接口域名，可搜索），以后服务商再多也不会把下面的 Key、模型挤出屏幕。
- **服务商**：OpenAI、Claude、Grok、DeepSeek、Gemini、OpenRouter、通义千问、豆包、Kimi、智谱 GLM、硅基流动、Vercel（AI Gateway）、Ollama（本机 `localhost:11434`）在下拉里选，接口地址自动填好（`src/llm/providers.ts`，地址、模型 id、是否支持 json_schema 都按各家官方文档核对过，2026-09-29）；其他兼容 OpenAI 接口的服务（包括自己部署的）在「自定义接口」里，填它的地址。只填域名会自动补 `/v1`，粘贴了 `…/chat/completions` 也会截回到 base URL。
- **API Key**：可以点眼睛图标显示；保存后显示「已保存 sk-…abcd」和「更换」按钮，Key 本身不再显示（换了服务商要重新填）。选「自定义」时填这个服务给你的 Key。Ollama 不校验 Key，随便填一个。
- **模型**：下拉里先是这个服务商的内置推荐模型（选服务商时自动选第一个），再是填好 Key 后从接口 `GET {接口地址}/models` 拿到的这个 Key 能用的模型；可以搜索，也可以直接填任意模型 id。
- **简报输出方式**：简报要模型输出结构化 JSON，有两种策略，和模型不绑定，可以任意组合（内置服务商只带一个默认值）：
  - **JSON Schema**：请求带 `response_format: json_schema`，由接口强制约束，最稳。OpenAI、Gemini、Grok、通义千问、豆包、Kimi、Ollama 等支持。
  - **JSON 模式**：给不支持 json_schema 的模型用（DeepSeek、智谱、Claude 的 OpenAI 兼容接口，以及不支持的本地模型）：把 JSON Schema 写进提示词，请求带 `response_format: json_object`，去掉模型可能包上的 markdown 代码块，再用同一个 schema 校验。
- **测试连接**：按当前选的输出方式调一次（一个类似简报的小 schema，和 daemon 生成简报的调用方式相同）。三种结果：正常；能对话但这种输出方式不行（JSON Schema 下会给「换成 JSON 模式再测」按钮，一点就切换并重测）；失败并说明原因（Key 无效、地址或模型不存在等）。
- **保存**：存进这台设备的本地设置；连着服务端且本机 daemon 在运行时，同时通过 `PUT http://127.0.0.1:8790/llm/settings` 设成 daemon 的主通道，下一份简报立即生效，不用重启。只有这一个接口，没有备用通道。Key 只在这台设备和本机 daemon 之间传，不经过服务端。
- **清除配置**：本地和 daemon 的配置一起清掉。

所有调用都走 AI SDK 的 `@ai-sdk/openai-compatible`，不用为每家服务商写适配。

没配置时，提问会失败并提示去这里填写。首次启动时，如果构建环境里有 `VITE_OUTBRIEF_LLM_BASE_URL`、`VITE_OUTBRIEF_LLM_API_KEY`、`VITE_OUTBRIEF_LLM_MODEL`，就用它们预填（`pnpm dev:all` 会从 outbrief-daemon 配置 `${OUTBRIEF_HOME:-~/.outbrief}/daemon.json` 的 `llm.primary` 读出来传进去）；一旦在设置里保存过，就以保存的为准。

## 图标

中文名「启奏」（有本启奏，无本退朝）：朱红底上一本展开的金边奏折，折页上的竖行字写成声波——Agent 上奏，用语音汇报。源文件是 `app-icon.svg`；改图后导出 1024×1024 的 `app-icon.png`，再运行 `pnpm tauri icon app-icon.png` 重新生成 `src-tauri/icons/` 下所有尺寸。

## 桌面端

关窗口只收到托盘，来电时窗口弹出。没有开机自动启动。

只能开一个（`tauri-plugin-single-instance`，YOUT-226）：两个窗口会各自把每通电话再响一遍，接一个的时候另一个还在响。再打开一次只会把已经在运行的窗口叫到前面；`pnpm dev:all` 启动前会先关掉还在运行的桌面端（旧版本、别的 worktree 起的）。

## 本地开发

需要 Node ≥ 22.18、pnpm 9、Rust stable ≥ 1.85（Tauri 依赖要求 edition 2024），以及 [Tauri 平台依赖](https://tauri.app/start/prerequisites/)。

一条命令起全套（MySQL 容器 → 同级目录的 outbrief-server → 桌面窗口），托盘里点「退出」或 Ctrl+C 一起停：

```bash
pnpm dev:all        # 即 scripts/dev.sh；服务端日志在 logs/server.log
```

服务端目录默认是同级目录（`outbrief-app` → `outbrief-server`，worktree `app-p1` → `server-p1`），其他位置用 `OUTBRIEF_SERVER_DIR=<目录>` 指定，服务端不需要 `.env`。脚本会把服务器地址传给桌面端；服务端还没有主人时，把日志里的认领码也传过去，桌面端自动创建第一个账号（本机有 outbrief-daemon 时则加入它的账号）；outbrief-daemon 配置里有 `llm.primary` 时，也会把它作为「设置 → 大模型」的默认值传进去（不打印 Key）。桌面端没有登录。

只起桌面端或前端：

```bash
pnpm install
pnpm tauri dev      # 桌面窗口 + 热更新（前端 dev server 在 :1520，避开其他 Tauri 项目常用的 :1420）
pnpm dev            # 只起前端（浏览器里调 UI）
```

单独起桌面端时，首次打开按上文「账号和设备」自动加入或创建账号；不能自动完成时在欢迎页填服务地址（默认 `http://localhost:8787`）、认领码或配对码。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm lint` / `pnpm format` | Biome 检查 / 自动修复 |
| `pnpm typecheck` | `tsc` |
| `pnpm test` | Vitest |
| `pnpm build` | 构建前端到 `dist/` |
| `pnpm tauri build` | 打包桌面安装包 |
| `scripts/build-android.sh` | 打 Android 试用安装包 `dist-android/OutBrief.apk`（见下） |
| `pnpm tauri ios init` | 生成 iOS 工程（二期） |

## Android 安装包

`scripts/build-android.sh` 打一个 arm64 的 release APK，直接装到手机上试用（不上架）。要先装好 rustup（`rustup target add aarch64-linux-android`，Homebrew 的 rust 没有 Android 目标）、JDK 17、Android SDK（`platforms;android-36`、`build-tools`）和 NDK，用 `ANDROID_HOME`、`NDK_HOME`、`JAVA_HOME` 指定。

- 服务地址默认 `https://api.outbriefapp.com`，用 `VITE_OUTBRIEF_SERVER_URL` 换；手机连不到电脑上的 `localhost`。装好后在电脑上的 App 里打开「设置 → 设备 → 添加设备」，手机扫码加入同一个账号。
- `src-tauri/gen/` 不进仓库：脚本在没有时先 `tauri android init`，再补上相机 / 麦克风权限（扫码、录音）和 release 签名。签名密钥第一次打包时生成在 `~/.outbrief-android/`（含随机密码，不在仓库里），之后一直用它签，新包才能覆盖安装。
- Android 的系统 WebView 用 Google Play 服务实现 `BarcodeDetector`，App 没声明时一扫码就闪退（很多手机也没有 Play 服务），所以 Android 版扫码用 `qr-scanner` 自带的解码 worker（`src/components/QrScanner.tsx`）。

## License

[OutBrief License](LICENSE)（基于 Apache License 2.0 并附加条件，参照 [Multica License](https://github.com/multica-ai/multica/blob/main/LICENSE)）。
