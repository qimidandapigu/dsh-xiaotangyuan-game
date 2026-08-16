# 架构和职责边界

## 总体结构

```text
玩家
├─ 文字输入
├─ Windows 麦克风
└─ 游戏窗口画面
          ↓
DeepSeek Harness
└─ 小汤圆 Harness 插件
   ├─ Agent / 模型 / 上下文
   ├─ 多模态 / ASR / TTS Provider
   ├─ Windows 媒体 Host
   ├─ 游戏安装器
   └─ localhost Gateway
          ↓ protocol/v1
游戏薄适配器
├─ 游戏状态与事件
├─ 游戏 API 动作
└─ 游戏内 UI
```

核心规则：凡是不依赖具体游戏进程就能完成的能力，都归 Harness；只有必须调用游戏运行时或游戏 API 的工作才进入适配器。

## 职责矩阵

| Harness 插件 | 游戏适配器 |
|---|---|
| Agent 循环和模型调度 | 读取准确游戏状态 |
| Prompt、上下文和记忆 | 订阅游戏事件 |
| Schema 校验、重试和工具编排 | 调用游戏 API 执行动作 |
| 多模态、ASR、TTS Provider | 游戏内文字输入与呈现 |
| 麦克风、窗口捕获和音频播放 | 上报游戏进程 ID |
| 密钥、权限、日志和版本安装 | 返回动作结果与错误 |

Provider 密钥不能进入游戏适配器或 `protocol/v1`。适配器也不能依赖某个厂商的 SDK 或专属消息结构。

## 星露谷表现层组件化

```text
StardewAgentMod
  AI 状态与小汤圆位置关联
          ↓
XiaoTangYuanCompanion
  图像与数据配置
          ↓
Content Patcher + TrinketTinker
  加载、跟随、动画与渲染
```

小汤圆不自行重写宠物跟随和动画框架。Harness 安装器负责发现和安装成熟第三方组件，星露谷适配器只保留 AI 必须的桥接代码。

## 语音链路

```text
StardewAgentMod adapter.hello(processId)
          ↓
Gateway 将允许的游戏进程交给媒体 Host
          ↓
前台游戏按住 V → WAV 录音 → 松开
          ↓
ASR → GameAgentSession → TTS
          ↓
assistant.status / present / error → 游戏气泡
```

媒体 Host 不接受任意后台进程触发热键。原始音频不进入游戏 JSON-RPC 协议；它只在 Harness 的本机媒体链路中处理。

## 安装与供应链

```text
Harness 对话
  → game_mod_detect
  → game_mod_install
  → v2 静态清单
  → 官方来源下载
  → 大小 + SHA-256
  → manifest / UniqueID / 版本
  → 事务替换
```

第一方与第三方发布物保持分离：

- 小汤圆星露谷 Release：适配器 + 外观包。
- Content Patcher：官方 CurseForge 下载。
- TrinketTinker：官方 GitHub Release 下载。

安装失败时回滚本轮已经替换的组件。备份统一放在游戏根目录 `.xiaotangyuan-backups`，避免 SMAPI 扫描到旧副本。插件 `0.5.1` 还会迁移旧安装器遗留在 `Mods` 中的小汤圆相关备份。

## 能力与 Provider

产品要求的是能力，不是固定厂商：

1. `vision.observe`
2. `speech.transcribe`
3. `speech.synthesize`
4. 麦克风录制
5. 音频播放

接口允许为不同能力选择不同 Provider。当前实现状态必须与架构目标区分：视觉可使用 DSH 中支持图片输入的模型；语音接口已抽象，但插件 `0.5.1` 当前只注册火山引擎实现。

## 协议边界

`protocol/v1` 使用本机 WebSocket 与 JSON-RPC 2.0。协议传递语义化文本、状态、事件和结果，不传 Provider Key，也不把原始 RGBA、Base64 截图或持续音频帧塞进 JSON。

实时寻路、战斗和动画等低延迟确定性逻辑应留在游戏或成熟游戏组件中，不能交给远程模型逐帧控制。
