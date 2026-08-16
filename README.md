# dsh-xiaotangyuan-game

小汤圆游戏 AI 的单仓库。DeepSeek Harness 插件承载通用 AI、语音、多模态、结构化处理和工程运行时；每个游戏只保留必须调用游戏 API 的薄适配器。

```text
麦克风 / 游戏窗口 / 游戏事件
              |
              v
apps/harness-plugin          一套可复用的重型运行时
  Agent + 上下文 + 工具 + Provider 调度
  多模态 + ASR + TTS + 主机媒体能力
              |
              v  protocol/v1
games/*/adapter              少量游戏专属桥接代码
  读取游戏状态 + 执行动作 + 游戏内界面
```

智谱、豆包或其他服务只是可替换的 Provider。产品要求的是多模态理解、语音识别、语音合成、麦克风采集和音频播放能力，不把核心架构绑定到某个厂商。

## 仓库目录

```text
apps/
  harness-plugin/            发布给 DeepSeek Harness 的插件
    src/gateway/             适配器连接与请求路由
    src/runtime/agent/       Harness Agent 会话
    src/runtime/providers/   与厂商无关的能力接口
    src/installation/        游戏适配器检测与安装
    src/tools/               暴露给模型的 Harness 工具
    src/protocol/            Gateway 使用的协议解析代码
    test/                    插件测试
protocol/
  v1/                        与语言无关的适配器协议
games/
  stardew-valley/
    adapter/                 轻量 SMAPI 桥接
docs/                        架构和职责说明
```

以后新增游戏时统一放在 `games/` 下，不再为每个游戏创建独立仓库，也不重复开发模型调用、语音、记忆或媒体基础设施。

## 安装

首次将小汤圆插件安装到 DeepSeek Harness：

```powershell
dsh plugin --profile web add "https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/plugin-v0.4.2/qimidandapigu-dsh-xiaotangyuan-game-0.4.2.tgz"
```

重启 Harness、刷新页面并新建对话，然后说：

```text
小汤圆，帮我检测并安装星露谷物语的 AI MOD
```

插件会调用 `game_mod_detect` 和 `game_mod_install`，检测 Steam、星露谷与 SMAPI，下载最新的 `stardew-v*` 安装包，校验 SHA-256，备份旧版本并安装到游戏的 `Mods/StardewAgentMod` 目录。游戏适配器没有内置在插件包里，而是由插件在收到安装请求后从同一仓库的独立 Release 下载。宠物素材随游戏适配器一起安装，不需要额外安装 Content Patcher 或第三方宠物 MOD。

如果已经安装过旧的 `@qimidandapigu/dsh-game-agent`，请先移除它，避免两个 Gateway 同时占用 `32145` 端口。

## 常用命令

```powershell
pnpm install
pnpm check
pnpm build:stardew
pnpm pack:plugin
```

发布的插件包名仍为 `@qimidandapigu/dsh-xiaotangyuan-game`。游戏适配器二进制文件使用独立的 Release 安装包；用户在 Harness 中提出安装请求后，由插件按需下载。

## 当前状态

Harness 插件 `0.4.2` 已实现 Gateway、结构化星露谷状态、多模态模型自动选择、DSH 凭据驱动的语音 Provider、稳定发布清单、升级时保留游戏配置，以及随插件分发的 Windows 麦克风与音频播放 Host。星露谷适配器 `0.4.0` 内置小汤圆宠物形象和录音/思考气泡反馈。日记、主动对话、关系任务和完整游戏动作仍在后续迁移范围内。

## 许可证

MIT
