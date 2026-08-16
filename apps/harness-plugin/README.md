# @qimidandapigu/dsh-xiaotangyuan-game

这是运行在 DeepSeek Harness 中的“小汤圆游戏 AI”重型运行时。

## 负责范围

本插件统一负责：

- Agent 会话与模型调度。
- 多模态、语音识别和语音合成 Provider 调度。
- 结构化输出、校验、重试和工具编排。
- 麦克风、游戏窗口捕获和音频播放等主机媒体能力。
- 本地游戏 Gateway。
- 游戏适配器检测、安装与升级。

游戏专属代码不会打进这个 npm 插件包。编译后的游戏适配器使用同一 GitHub 仓库中的独立 Release 安装包；用户在 Harness 中提出安装请求后，由插件下载并安装。

## 安装

```powershell
dsh plugin --profile web add "https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/plugin-v0.4.1/qimidandapigu-dsh-xiaotangyuan-game-0.4.1.tgz"
```

重启 Harness 后即可通过对话让小汤圆检测并安装各游戏的适配器。星露谷物语的请求示例：`小汤圆，帮我检测并安装星露谷物语的 AI MOD`。

Gateway 只允许绑定本机回环地址，默认地址为 `ws://127.0.0.1:32145`。

## Provider 原则

语音和多模态是引擎必备能力，智谱、豆包等厂商只是可替换实现。Provider 密钥只保存在 Harness 中，不进入任何游戏适配器。
