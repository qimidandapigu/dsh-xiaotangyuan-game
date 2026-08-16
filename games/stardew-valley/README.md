# 小汤圆游戏 AI：星露谷物语

这是 `dsh-xiaotangyuan-game` 的星露谷集成。`adapter/` 是轻量 SMAPI AI 桥接，`content-pack/` 只保存小汤圆外观和组件配置。

它只负责星露谷专属的状态、事件、动作和游戏内呈现。模型 Provider、Prompt、记忆、麦克风采集、语音识别、语音合成和音频播放都归 Harness 插件负责。

## 自动安装

先安装 Harness 插件，然后在 DeepSeek Harness 中说：

```text
小汤圆，帮我检测并安装星露谷 AI MOD
```

插件会检测游戏和 SMAPI，再完成以下安装：

- 从本仓库 `stardew-v*` Release 安装 `StardewAgentMod` 与 `XiaoTangYuanCompanion`。
- 从官方来源安装或升级 Content Patcher 与 TrinketTinker。
- 对所有下载校验固定的文件大小和 SHA-256，并在覆盖旧版本前备份。

因此用户只要说一次“帮我安装”，无需手动安装依赖；第三方组件仍保持独立来源和许可证，不会复制进本仓库的安装包。

## 手动安装

建议使用 Harness 自动安装。手动安装时，需要：

1. 安装 Content Patcher `2.9.0` 或更高版本。
2. 安装 TrinketTinker `1.9.0` 或更高版本。
3. 从本仓库最新的 `stardew-v*` Release 下载压缩包，把其中的 `StardewAgentMod` 和 `XiaoTangYuanCompanion` 解压到星露谷的 `Mods` 目录。

## 使用

通过 SMAPI 启动星露谷并进入存档：

- 按 `T` 输入文字。
- 保持游戏在前台，按住 `V` 说话，松开后由 Harness 完成识别、看图、回复和语音播放。录音、识别和思考状态会显示在小汤圆头顶。

适配器每秒向 Harness 上报一次结构化游戏状态，并把 AI 状态气泡定位到小汤圆同伴。宠物跟随、动画和渲染由 TrinketTinker 负责；资源加载由 Content Patcher 负责。麦克风和扬声器不由 MOD 直接访问。

## 兼容性

要求 Stardew Valley `1.6.15`、SMAPI `4.4.0` 或更高版本。SMAPI `UniqueID` 继续使用 `qimidandapigu.StardewAgent`，安装目录继续使用 `StardewAgentMod`，因此可以原地升级旧版本，不会生成重复 MOD。
