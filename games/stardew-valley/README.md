# 小汤圆游戏 AI：星露谷物语

这是 `dsh-xiaotangyuan-game` 的轻量星露谷 SMAPI 适配器，源码位于 `adapter/`。

它只负责星露谷专属的状态、事件、动作和游戏内呈现。模型 Provider、Prompt、记忆、麦克风采集、语音识别、语音合成和音频播放都归 Harness 插件负责。

## 自动安装

先安装 Harness 插件，然后在 DeepSeek Harness 中说：

```text
小汤圆，帮我检测并安装星露谷 AI MOD
```

插件会检测游戏和 SMAPI，再下载并验证最新的 `stardew-v*` Release 安装包。小汤圆宠物素材随适配器一起安装，不需要另外安装 Content Patcher 或其他宠物 MOD。

## 手动安装

从本仓库最新的 `stardew-v*` Release 下载压缩包，将其中的 `StardewAgentMod` 文件夹解压到星露谷的 `Mods` 目录。

## 使用

通过 SMAPI 启动星露谷并进入存档：

- 按 `T` 输入文字。
- 保持游戏在前台，按住 `V` 说话，松开后由 Harness 完成识别、看图、回复和语音播放。录音、识别和思考状态会显示在小汤圆头顶。

适配器每秒向 Harness 上报一次结构化游戏状态，并在游戏内显示非阻塞对话气泡。麦克风和扬声器不由 MOD 直接访问。

## 兼容性

SMAPI `UniqueID` 继续使用 `qimidandapigu.StardewAgent`，安装目录继续使用 `StardewAgentMod`，因此 `0.4.0` 可以原地升级旧版本，不会生成重复 MOD。
