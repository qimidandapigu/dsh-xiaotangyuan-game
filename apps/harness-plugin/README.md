# @qimidandapigu/dsh-xiaotangyuan-game

运行在 DeepSeek Harness 中的“小汤圆游戏 AI”重型运行时。当前插件版本为 `0.6.1`。

## 职责

- Agent 会话与默认模型调用。
- 按 Adapter 进程截取游戏窗口客户区与多模态模型路由。
- ASR、TTS 与语音 Provider 调度。
- Windows 麦克风、前台游戏热键和音频播放。
- 本地 WebSocket Gateway。
- 游戏适配器检测、下载、校验、备份、安装和回滚。
- 暴露星露谷和饥荒的 Mod 检测/安装工具给 Harness Agent。

游戏专属 DLL 不打进本插件。编译后的适配器通过同仓库独立 Release 按需下载。

## 安装

`0.6.1` 是当前源码版本，尚未公开发布。公开稳定版仍为 `0.5.1`；开发测试请先在仓库根目录构建：

```powershell
pnpm install
pnpm build:media
pnpm check
pnpm pack:plugin
```

然后安装生成的本地包：

```powershell
dsh plugin --profile web add ".\qimidandapigu-dsh-xiaotangyuan-game-0.6.1.tgz"
```

只有在 `plugin-v0.6.1` Release 实际创建后，才应使用对应的 GitHub 下载地址。

安装后重启 Harness。默认监听：

```text
ws://127.0.0.1:32145
```

Gateway 只允许 `127.0.0.1`、`localhost` 或 `::1`，不会暴露到局域网。

## 配置

配置结构：

| 字段 | 默认值 | 作用 |
|---|---|---|
| `host` | `127.0.0.1` | Gateway 地址，仅允许回环地址 |
| `port` | `32145` | Gateway 端口 |
| `vision.enabled` | `true` | 启用游戏截图理解 |
| `vision.prompt` | 内置中文观察提示 | 视觉模型观察指令 |
| `vision.maxWidth` | `1280` | 游戏客户区截图的最大宽度 |
| `speech.enabled` | `true` | 启用 ASR 与 TTS |
| `speech.provider` | `auto` | 从已注册语音 Provider 中选择 |
| `speech.credentialRef` | `VOLCENGINE_API_KEY` | DSH 凭据名称，不是 Key 内容 |
| `speech.asrResourceId` | `volc.bigasr.auc` | 当前火山 ASR 资源 |
| `speech.ttsResourceId` | `seed-tts-1.0` | 当前火山 TTS 资源 |
| `speech.ttsVoice` | 内置中文女声 | TTS 发音人 |
| `media.enabled` | `true` | 启用 Windows 媒体 Host |
| `media.pushToTalkVirtualKey` | `86` | Windows Virtual-Key，默认 `V` |
| `media.executablePath` | 插件内置路径 | 自定义媒体 Host 路径 |
| `installers.dontStarve.manifestUrl` | 官方 v1 清单 | 饥荒安装包发布清单 |
| `installers.dontStarve.archivePath` | 无 | 仅供本地开发的绝对 ZIP 路径；必须同时配置版本和 SHA-256 |

## AI 自动反馈

配置反馈接收端后，小汤圆会通过模型工具调用识别明确的产品建议。例如玩家说“如果能够加钓鱼功能就好了”，模型会自动整理标题、摘要和玩家原话，调用 `game_feedback_submit`，接收端验证官方 Harness 签名后在私有 GitHub 仓库创建 Issue。玩家不需要 Git、GitHub 账号或手工填写问卷。

```yaml
feedback:
  enabled: true
  endpoint: https://your-feedback-worker.example/v1/feedback
  clientId: xiaotangyuan-official
  credentialRef: XIAOTANGYUAN_FEEDBACK_TOKEN
```

反馈凭据由接收端签发并保存在 DSH 凭据库中；它不是模型 API Key。插件只保存凭据引用，每个请求使用 HMAC-SHA256、时间戳和一次性 nonce 签名。没有有效官方反馈凭据的请求会被接收端拒绝。

## Provider 原则

Provider 接口是厂商无关的，但 `0.6.1` 实际注册的语音实现只有 `VolcengineSpeechProvider`。新增厂商时应实现通用 `SpeechCapabilityProvider`，不能修改任何游戏 Adapter。

所有真实密钥通过 `ctx.credentials.resolve(ref)` 在操作时解析。插件配置只保存凭据引用，不缓存或持久化秘密。

## 语音链路

```text
游戏适配器连接 Gateway 并上报进程 ID
                 ↓
媒体 Host 只接受前台且已连接的游戏进程，并只截取客户区
                 ↓
按住 V → 录制默认麦克风 → 松开 V
                 ↓
ASR → 游戏 Agent → TTS → Windows 播放
```

`Shift+V`、`Ctrl+V`、`Alt+V` 不会触发普通按住说话，方便游戏 Adapter 把组合键用于“重试”等游戏专属动作。Gateway 还提供 `chat.retry`（保留会话但禁止重复反馈）和 `assistant.compose`（一次性生成，不污染对话记忆）。

媒体 Host 是 Windows x64 自包含程序，打包时必须确认 `.tgz` 中存在：

```text
media/windows-x64/XtyMediaHost.exe
```

## 星露谷安装器

安装器会：

1. 自动查找 Steam 与星露谷目录。
2. 检查 SMAPI 和四个组件版本。
3. 读取 v2 静态发布清单，GitHub API 仅作回退。
4. 拒绝未知组件、非官方地址、超限包和不匹配的 SHA-256。
5. 解压后验证 `manifest.json`、`UniqueID` 和版本。
6. 保留旧 `StardewAgentMod/config.json`。
7. 事务安装，失败时回滚本轮替换。
8. 将备份写入游戏根目录 `.xiaotangyuan-backups`。
9. 自动迁移旧安装器遗留在 `Mods` 中的小汤圆相关备份。

## 饥荒联机版安装器

玩家在 Harness 中发送“检测并安装《饥荒联机版》的小汤圆 AI Mod”后，Agent 会先调用 `dont_starve_mod_detect`，再在明确安装请求下调用 `dont_starve_mod_install`。安装器会：

1. 自动查找 Steam 中的《饥荒联机版》。
2. 读取 `distribution/dont-starve-together-v1.json`。
3. 限制官方 Release 地址、安装包名称与最大体积，并验证 SHA-256。
4. 把旧 Mod 整体备份到游戏根目录 `.xiaotangyuan-backups`。
5. 安装 Lua Mod 与 Harness Adapter 启动器，随后核对版本和启动器。
6. 只迁移旧 `.env` 中的 `HARNESS_*` 与 `DST_*` 配置，不迁移旧直连模型 Key。
7. 任何安装或验证失败都会恢复旧目录。
8. 返回需要写入 Steam 的启动项；Steam 不提供可靠的官方接口供工具直接修改该字段。

## 缺氧安装器

缺氧安装器不属于本通用 Harness 包，而属于可选的
`@qimidandapigu/oni-adapter`。只有玩家安装该 Adapter 后，Harness
才会加载 ONI 知识、游戏动作和下面两个安装工具。

玩家在 Harness 中发送“检测并安装《缺氧》的 AI 精灵 Mod”后，Agent 会先调用
`oxygen_not_included_mod_detect`，再在明确安装请求下调用
`oxygen_not_included_mod_install`。安装器会：

1. 自动查找 Steam 中的《缺氧》，并检测 Documents 下的本地 Mod。
2. 读取 `distribution/oxygen-not-included-v1.json`，限制官方 Release 地址、名称和体积并验证 SHA-256。
3. 把旧 Bridge 备份到 `mods/.xiaotangyuan-backups`，再事务安装新的 C# Bridge。
4. 校验 DLL 和 `mod_info.yaml` 版本；失败自动恢复旧目录。
5. 不迁移旧版 `config.json`，避免把旧直连模型 Key 带进新架构。
6. TypeScript ONI Adapter 作为独立 Harness 插件运行，不复制到《缺氧》Mod 目录。

更多用户步骤见[安装指南](../../docs/INSTALLATION.md)，故障定位见[排错指南](../../docs/TROUBLESHOOTING.md)。
