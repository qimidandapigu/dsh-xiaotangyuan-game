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
   ├─ 分层记忆与自动反馈
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

## 窗口与媒体所有权

游戏 Adapter 在 `adapter.hello` 中上报真实游戏进程 ID。Harness 的通用媒体层根据该进程定位客户窗口，只截取客户区，不截取整个桌面；按住说话也只接受当前位于前台且已经连接的游戏进程。星露谷、饥荒和后续游戏复用同一套窗口、麦克风和播放能力，Adapter 不再各自实现截图或录音。

## 规划中的记忆分层

```text
全局玩家偏好        玩家明确允许时跨游戏共享
角色身份            按角色槽隔离，可由玩家选择复用
游戏专属记忆        按游戏 ID 隔离
当前存档记忆        按游戏 ID + 存档 ID 隔离
```

这部分是后续实现约束，不代表 `0.6.1` 已经提供完整的记忆管理界面。存档与当前世界状态始终归游戏所有。Harness 只保存对话侧的记忆视图，跨游戏共享必须由玩家主动控制；星露谷的角色经历不能默认进入缺氧或饥荒上下文。游戏配置和 Adapter 配置也按游戏隔离，模型与语音 Provider 配置可以在 Harness 层复用。

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
  → 按游戏选择 detect / install 工具
  → 星露谷 v2 或饥荒 v1 静态清单
  → 官方来源下载
  → 大小 + SHA-256
  → manifest / UniqueID / 版本
  → 事务替换
```

第一方与第三方发布物保持分离：

- 小汤圆星露谷 Release：适配器 + 外观包。
- 小汤圆饥荒 Release：Lua Mod + Harness Adapter 启动器。
- Content Patcher：官方 CurseForge 下载。
- TrinketTinker：官方 GitHub Release 下载。

安装失败时回滚本轮已经替换的组件。备份统一放在游戏根目录 `.xiaotangyuan-backups`，避免 SMAPI 扫描到旧副本。自插件 `0.5.1` 起还会迁移旧安装器遗留在 `Mods` 中的小汤圆相关备份。

## 能力与 Provider

产品要求的是能力，不是固定厂商：

1. `vision.observe`
2. `speech.transcribe`
3. `speech.synthesize`
4. 麦克风录制
5. 音频播放

接口允许为不同能力选择不同 Provider。当前实现状态必须与架构目标区分：视觉可使用 DSH 中支持图片输入的模型；语音接口已抽象，但插件 `0.6.1` 当前只注册火山引擎实现。

## 协议边界

`protocol/v1` 使用本机 WebSocket 与 JSON-RPC 2.0。协议传递语义化文本、状态、事件和结果，不传 Provider Key，也不把原始 RGBA、Base64 截图或持续音频帧塞进 JSON。

实时寻路、战斗和动画等低延迟确定性逻辑应留在游戏或成熟游戏组件中，不能交给远程模型逐帧控制。

## 自动反馈边界

```text
玩家自然语言建议
  → Agent 判断是否为明确产品反馈
  → game_feedback_submit 整理结构化内容
  → 官方 Harness 使用 HMAC-SHA256 签名
  → Cloudflare Worker 验签、限流、防重放
  → Worker Secret 中的 GitHub Token 创建私有 Issue
```

玩家不需要 Git、GitHub 账号或手工问卷。GitHub Token 只存在接收端 Secret，Harness 保存的是反馈签名凭据引用，模型只能调用受限工具，不能读取任一密钥。接收端应限制目标仓库、请求体大小、时间窗口和 nonce，并为不同发行批次规划密钥轮换。

## 可选游戏 Adapter

通用 Harness 插件只提供跨游戏能力和安装入口。必须携带大量游戏知识或动作工具的 Adapter（例如缺氧）独立安装；未安装该 Adapter 的玩家不会下载对应代码，也不会把其 Prompt、工具或记忆注入其他游戏。
