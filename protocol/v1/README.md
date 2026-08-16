# 小汤圆游戏协议 v1

本目录定义 Harness 插件和轻量游戏适配器之间与编程语言无关的通信契约。TypeScript、C#、Lua 等实现都必须遵守这里的协议，不能直接引入某个 Provider 的专属类型。

## 传输方式

- 使用本机回环地址上的 WebSocket。
- 消息格式为 JSON-RPC 2.0。
- 适配器必须先发送一次 `adapter.hello`，然后才能发送其他请求。

## 当前方法

| 方法 | 方向 | 用途 |
|---|---|---|
| `adapter.hello` | 适配器 → Harness | 声明适配器、游戏、版本和协议版本 |
| `gateway.ping` | 适配器 → Harness | 检查 Gateway 是否正常 |
| `chat.send` | 适配器 → Harness | 发送玩家文本和少量结构化游戏上下文 |
| `state.update` | 适配器 → Harness | 上报最新结构化游戏状态，不包含音频和密钥 |
| `assistant.status` | Harness → 适配器 | 显示录音、转写或思考状态 |
| `assistant.present` | Harness → 适配器 | 显示最终回复文本 |
| `assistant.error` | Harness → 适配器 | 显示本次交互的可恢复错误 |

## 后续扩展

后续协议将增加：

- 结构化游戏观察。
- 游戏事件上报。
- 游戏工具发现。
- 动作执行及执行结果。
- 最终文本和游戏内呈现事件。

协议只传递有语义的游戏数据。麦克风原始数据、Provider 密钥和厂商配置都由 Harness 管理，不进入游戏适配器协议。
