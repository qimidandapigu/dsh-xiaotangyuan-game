# @qimidandapigu/dsh-xiaotangyuan-game

运行在 DeepSeek Harness 中的“小汤圆游戏 AI”重型运行时。当前插件版本为 `0.5.1`。

## 职责

- Agent 会话与默认模型调用。
- 游戏截图与多模态模型路由。
- ASR、TTS 与语音 Provider 调度。
- Windows 麦克风、前台游戏热键和音频播放。
- 本地 WebSocket Gateway。
- 游戏适配器检测、下载、校验、备份、安装和回滚。
- 暴露 `game_mod_detect` 与 `game_mod_install` 给 Harness Agent。

游戏专属 DLL 不打进本插件。编译后的适配器通过同仓库独立 Release 按需下载。

## 安装

```powershell
dsh plugin --profile web add "https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/plugin-v0.5.1/qimidandapigu-dsh-xiaotangyuan-game-0.5.1.tgz"
```

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
| `speech.enabled` | `true` | 启用 ASR 与 TTS |
| `speech.provider` | `auto` | 从已注册语音 Provider 中选择 |
| `speech.credentialRef` | `VOLCENGINE_API_KEY` | DSH 凭据名称，不是 Key 内容 |
| `speech.asrResourceId` | `volc.bigasr.auc` | 当前火山 ASR 资源 |
| `speech.ttsResourceId` | `seed-tts-1.0` | 当前火山 TTS 资源 |
| `speech.ttsVoice` | 内置中文女声 | TTS 发音人 |
| `media.enabled` | `true` | 启用 Windows 媒体 Host |
| `media.pushToTalkVirtualKey` | `86` | Windows Virtual-Key，默认 `V` |
| `media.executablePath` | 插件内置路径 | 自定义媒体 Host 路径 |

Provider 接口是厂商无关的，但 `0.5.1` 实际注册的语音实现只有 `VolcengineSpeechProvider`。新增厂商时应实现通用 `SpeechCapabilityProvider`，不能修改星露谷适配器。

所有真实密钥通过 `ctx.credentials.resolve(ref)` 在操作时解析。插件配置只保存凭据引用，不缓存或持久化秘密。

## 语音链路

```text
游戏适配器连接 Gateway 并上报进程 ID
                 ↓
媒体 Host 只接受前台且已连接的游戏进程
                 ↓
按住 V → 录制默认麦克风 → 松开 V
                 ↓
ASR → 游戏 Agent → TTS → Windows 播放
```

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

更多用户步骤见[安装指南](../../docs/INSTALLATION.md)，故障定位见[排错指南](../../docs/TROUBLESHOOTING.md)。
