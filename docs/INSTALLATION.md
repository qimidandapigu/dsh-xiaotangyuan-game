# 安装与升级

## 版本与前置条件

当前仓库组合：

| 项目 | 要求 |
|---|---|
| DeepSeek Harness 插件 | 源码 `0.6.1`；最新公开 Release `0.5.1` |
| Stardew Valley | `1.6.15` 或更高 |
| SMAPI | `4.4.0` 或更高 |
| Content Patcher | 安装器固定为 `2.9.1` |
| TrinketTinker | 安装器固定为 `1.9.0` |
| 语音媒体 Host | Windows x64 |
| 饥荒联机版 Mod | `0.2.18` |

文字对话和游戏适配器不应依赖具体模型厂商。当前 `0.6.1` 源码中的语音 Provider 实现是火山引擎；视觉能力由 DSH 中支持图片输入的模型提供。

## 1. 安装 Harness 插件

```powershell
dsh plugin --profile web add "https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/plugin-v0.5.1/qimidandapigu-dsh-xiaotangyuan-game-0.5.1.tgz"
```

确认版本：

```powershell
dsh plugin --profile web list
```

输出中应出现：

```text
@qimidandapigu/dsh-xiaotangyuan-game 0.5.1
```

上面的地址是当前已公开稳定版。饥荒安装器、客户窗口截图和自动反馈属于 `0.6.1` 源码；在 `plugin-v0.6.1` Release 实际发布前，应从仓库构建 `.tgz` 后本地安装，不能使用尚不存在的 Release URL。

安装或升级插件后必须重启 Harness。默认服务地址是：

```text
Harness Web：http://127.0.0.1:3080
游戏 Gateway：ws://127.0.0.1:32145
```

如果还安装着旧包 `@qimidandapigu/dsh-game-agent`，应先移除旧包，避免两个 Gateway 争用 `32145`。

## 2. 配置模型和语音凭据

密钥只绑定到 DeepSeek Harness，不写进星露谷 MOD，也不写进小汤圆配置文件。

默认语音配置引用：

```text
credentialRef = VOLCENGINE_API_KEY
ASR resource   = volc.bigasr.auc
TTS resource   = seed-tts-1.0
```

插件保存的是 `VOLCENGINE_API_KEY` 这个凭据名称。真实 Key 由 DSH 凭据管理器解析和使用。若改用其他凭据名称，需要同时修改插件的 `speech.credentialRef`；不要把真实 Key 直接写入仓库或游戏 `config.json`。

## 3. 让 Harness 自动安装星露谷组件

刷新 Harness 页面、新建对话并发送：

```text
小汤圆，帮我检测并安装星露谷物语的 AI MOD
```

Harness 会依次调用：

```text
game_mod_detect
      ↓
game_mod_install
      ↓
下载 → 大小校验 → SHA-256 校验 → 解压验证 → 备份 → 安装后验证
```

最终 `Mods` 中应有四个目录：

| 目录 | 来源 | 职责 |
|---|---|---|
| `ContentPatcher` | Content Patcher 官方发布 | 加载内容包资源和数据 |
| `TrinketTinker` | TrinketTinker 官方发布 | 宠物跟随、动画与渲染 |
| `XiaoTangYuanCompanion` | 小汤圆星露谷 Release | 小汤圆图像和组件配置 |
| `StardewAgentMod` | 小汤圆星露谷 Release | 游戏状态、文字输入、Gateway 和气泡 |

第一方 Release 不包含第三方二进制。安装器使用 `distribution/stardew-valley-v2.json` 中固定的官方地址、文件大小和 SHA-256。

## 4. 让 Harness 自动安装饥荒联机版 Mod

此功能要求 Harness 插件 `0.6.1` 或更新版本。

刷新 Harness 页面、新建对话并发送：

```text
检测并安装《饥荒联机版》的小汤圆 AI Mod
```

Harness 会依次调用：

```text
dont_starve_mod_detect
      ↓
dont_starve_mod_install
      ↓
官方清单 → 大小与 SHA-256 → 备份 → 安装 → 版本验证 → 失败回滚
```

安装包同时包含 Lua Mod、轻量 Adapter 启动器和 `Jingling` 动画。安装完成后，Harness 会返回一行 Steam 启动项。把它完整复制到 Steam →《饥荒联机版》→ 属性 → 启动选项，保留末尾 `%command%`。之后先运行 Harness，再从 Steam 启动游戏即可。

首次验证应进入世界并找到切斯特：标题界面只能确认 Mod 加载，不能确认小汤圆实体和动画已经创建。

## 5. 启动和使用

星露谷安装完成后通过 SMAPI 启动或重启游戏；饥荒必须从带有上述启动项的 Steam 入口启动。已经运行的游戏不会动态加载新 Mod。

进入存档后：

- `T`：打开游戏内文字输入框。
- `V`：游戏窗口在前台时按住录音，松开提交。

`T` 由 SMAPI 适配器处理。`V` 由 Harness 中的 Windows 媒体 Host 全局监听，并且只允许当前已连接的游戏进程触发。

## 升级与备份

升级前，安装器会保留旧版本和 `StardewAgentMod/config.json`。备份位置：

```text
<Stardew Valley>\.xiaotangyuan-backups\
```

备份不能放在 `Mods`，否则 SMAPI 会把备份识别为同一 MOD 的重复副本。自插件 `0.5.1` 起会自动迁移旧版本遗留在 `Mods` 中、且属于小汤圆管理范围的备份。

安装过程中任何组件失败时，本轮已经替换的组件会回滚。安装器不会删除历史备份。

## 手动安装

自动安装是推荐方式。必须手动安装时：

1. 从官方来源安装 Content Patcher `2.9.1` 和 TrinketTinker `1.9.0`。
2. 从 `stardew-v0.5.0` Release 下载第一方压缩包。
3. 把 `StardewAgentMod` 与 `XiaoTangYuanCompanion` 解压到 `Mods`。
4. 确认 `Mods` 中没有任何同 ID 的旧副本或 `.backup-*` 目录。
5. 通过 SMAPI 重启游戏。

遇到问题请按[排错指南](TROUBLESHOOTING.md)检查，不要先删除备份。
