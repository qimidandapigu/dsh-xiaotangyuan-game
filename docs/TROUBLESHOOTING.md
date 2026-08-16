# 常见问题与排错

## 最短诊断顺序

```text
SMAPI 是否加载 StardewAgentMod？
  ├─ 否 → 先看 SMAPI-latest.txt
  └─ 是 → T 文字是否能打开？
          ├─ 否 → 检查游戏内按键与 MOD 日志
          └─ 是 → V 是否出现“正在听”？
                  ├─ 否 → 检查 Harness、Gateway、媒体 Host、前台窗口
                  └─ 是 → 检查 ASR 凭据、TTS 和音频设备
```

## T 和 V 都没反应

先检查 SMAPI 日志：

```text
%APPDATA%\StardewValley\ErrorLogs\SMAPI-latest.txt
```

正常日志应包含类似：

```text
XiaoTangYuan Game AI - Stardew Valley 0.5.0
Content Patcher 2.9.1
TrinketTinker 1.9.0
XiaoTangYuan Companion 0.5.0
```

如果出现 `multiple copies of this mod installed`，说明 `Mods` 中存在同一 `UniqueID` 的多个目录。先升级 Harness 插件到 `0.5.1`，然后再次让 Harness 执行检测和安装；它会把小汤圆管理的旧备份迁移到：

```text
<Stardew Valley>\.xiaotangyuan-backups
```

迁移后必须重启游戏，因为 SMAPI 只在启动阶段加载 MOD。

## T 能用，V 没反应

依次确认：

1. 游戏已经进入存档，不是在标题界面加载 MOD 的中间阶段。
2. 星露谷窗口在前台；媒体 Host 会核对前台进程 ID。
3. Harness 正在运行，并且插件版本是 `0.5.1`。
4. `127.0.0.1:32145` 正在监听。
5. Windows 默认录音设备可用，且没有被独占。
6. `media.enabled` 与 `speech.enabled` 没有关闭。
7. 默认热键仍为 Windows Virtual-Key `86`，即字母 `V`。

只读检查命令：

```powershell
dsh plugin --profile web list
Get-NetTCPConnection -State Listen |
  Where-Object LocalPort -In 3080,32145
```

## 出现“正在听”，但松开后失败

这说明热键、前台进程和麦克风录制已经工作，问题位于 ASR 或 Provider 配置。

检查：

- DSH 中是否配置了 `speech.credentialRef` 指向的凭据。
- 当前默认凭据名称是否为 `VOLCENGINE_API_KEY`。
- ASR/TTS Resource ID 是否已在对应账号开通。
- Harness 日志是否出现“没有可用的语音识别与合成 Provider”。

不要把真实 API Key 复制进 MOD 配置或仓库文件。

## 能转写和回复，但没有声音

这通常是 TTS 或 Windows 播放设备问题：

- 检查 Harness 是否返回 TTS 错误。
- 确认 Windows 默认播放设备正常。
- 确认生成音频格式为 `audio/wav`；媒体 Host 只接受 WAV 播放。

## 有对话，但小汤圆宠物不显示

说明 AI 适配器可能正常，问题位于表现组件。检查 SMAPI 是否加载：

```text
Content Patcher
TrinketTinker
XiaoTangYuan Companion
```

并确认 `Mods/XiaoTangYuanCompanion/content.json` 和两张 PNG 素材存在。宠物资源由 Content Patcher 加载，跟随与渲染由 TrinketTinker 负责，AI 适配器不再自行绘制宠物。

## Harness 页面能用，但游戏连不上

检查两端口：

```text
3080   Harness Web
32145  小汤圆游戏 Gateway
```

Gateway 只绑定本机回环地址。若 `32145` 被占用，检查是否同时安装或启动了旧的 `@qimidandapigu/dsh-game-agent`。

## 提交问题时需要的信息

请提供：

- Harness 插件版本。
- `StardewAgentMod`、Content Patcher、TrinketTinker 和外观包版本。
- `SMAPI-latest.txt` 中从“Loading mods”到“Mods loaded and ready”的相关片段。
- 按 `T`、按住 `V`、松开 `V` 分别出现什么现象。
- Harness 是否能监听 `32145`。

请先遮盖 API Key、Token 和其他凭据；日志中不应主动加入这些秘密。
