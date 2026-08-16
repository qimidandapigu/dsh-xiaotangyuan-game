# dsh-xiaotangyuan-game

小汤圆游戏 AI 的单仓库。DeepSeek Harness 插件承载通用 Agent、模型、多模态、语音、结构化处理和安装能力；每个游戏只保留必须调用游戏 API 的薄适配器。

```text
玩家文字 / 麦克风 / 游戏窗口
              ↓
DeepSeek Harness + 小汤圆插件
Agent、视觉、ASR、TTS、工具、安装器、媒体 Host
              ↓ protocol/v1
游戏薄适配器
读取状态、调用游戏 API、呈现回复
```

## 当前发布版本

| 组件 | 版本 | 说明 |
|---|---:|---|
| Harness 插件 | `0.5.1` | 通用运行时、语音媒体 Host、星露谷安装器 |
| 星露谷适配器 | `0.5.0` | SMAPI 薄桥接 |
| 小汤圆外观包 | `0.5.0` | Content Patcher 内容包 |
| Content Patcher | `2.9.1` | 官方第三方资源加载组件 |
| TrinketTinker | `1.9.0` | 官方第三方宠物跟随与渲染组件 |

Harness 插件和游戏包独立发版，所以版本号不要求完全相同。

## 快速开始

1. 安装 Harness 插件：

```powershell
dsh plugin --profile web add "https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/plugin-v0.5.1/qimidandapigu-dsh-xiaotangyuan-game-0.5.1.tgz"
```

2. 重启 DeepSeek Harness，刷新页面并新建对话。
3. 对小汤圆说：

```text
小汤圆，帮我检测并安装星露谷物语的 AI MOD
```

4. 安装完成后通过 SMAPI 启动或重启星露谷物语。

进入存档后：

- 按 `T` 输入文字并发送给小汤圆。
- 保持游戏窗口在前台，按住 `V` 录音，松开后进行 ASR、Agent 回复和 TTS 播放。

完整前置条件、凭据配置和升级说明见[安装指南](docs/INSTALLATION.md)。

## 仓库目录

```text
apps/
  harness-plugin/            DeepSeek Harness 插件
    src/gateway/             游戏连接与请求路由
    src/runtime/             Agent、多模态、语音、媒体能力
    src/installation/        游戏检测、下载、校验、安装与备份
    src/tools/               暴露给模型的安装工具
    test/                    插件测试
  windows-media-host/        Windows 麦克风与音频播放 Host
protocol/
  v1/                        与语言无关的 JSON-RPC 协议
games/
  stardew-valley/
    adapter/                 轻量 SMAPI AI 桥接
    content-pack/            小汤圆外观与 TrinketTinker 配置
distribution/                稳定发布清单与固定校验值
docs/                        中文安装、排错、架构与开发文档
```

以后新增游戏统一放在 `games/` 下，不为每个游戏重复开发模型调用、语音、记忆或媒体基础设施。

## 文档

- [安装与升级](docs/INSTALLATION.md)
- [常见问题与排错](docs/TROUBLESHOOTING.md)
- [架构和职责边界](docs/ARCHITECTURE.md)
- [开发与发布](docs/DEVELOPMENT.md)
- [更新记录](CHANGELOG.md)
- [星露谷适配器](games/stardew-valley/README.md)
- [Harness 插件配置](apps/harness-plugin/README.md)
- [游戏协议 v1](protocol/v1/README.md)

## 安装与安全原则

- 插件包和星露谷包分开发布；游戏适配器不塞进 Harness 插件。
- 第一方星露谷包只包含 `StardewAgentMod` 和 `XiaoTangYuanCompanion`。
- Content Patcher 与 TrinketTinker 从各自官方来源下载，不重新打包进本仓库 Release。
- 下载前校验来源、版本、文件大小和 SHA-256。
- 覆盖升级使用事务安装；失败时恢复旧版本。
- 备份保存在游戏根目录 `.xiaotangyuan-backups`，绝不放进 `Mods`。
- Provider 密钥由 DSH 凭据管理器保存；插件只保存凭据名称，不保存 Key 内容。

## 开发命令

```powershell
pnpm install
pnpm check
pnpm build:stardew
pnpm build:media
pnpm pack:plugin
```

更多构建、测试和发版约束见[开发与发布](docs/DEVELOPMENT.md)。

## 许可证

MIT。第三方组件遵循各自许可证，本仓库不改变或重新授权它们。
