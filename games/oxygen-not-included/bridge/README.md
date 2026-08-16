# Oxygen Not Included C# Bridge

这是 AIHarness 缺氧 Adapter 的游戏内 Bridge，只负责：

- 读取周期、世界、鼠标格、选中对象和复制人状态；
- 显示精灵、文字面板、状态和回复气泡；
- 校验并执行移动、挖掘、分段挖路和白名单建筑任务；
- 通过本地文件协议与 TypeScript ONI Adapter 通信。

模型、API Key、截图、录音、ASR、TTS、对话历史和长期记忆全部由 AIHarness 管理，本 Mod 不包含这些实现。

当前 Bridge 版本为 `0.6.1`。它修复了四帧横向 Sprite Sheet 被整张压进一个方框的问题，精灵会按单帧动画绘制。Bridge 通过下面的用户目录加载，不应复制到 Steam 游戏程序集目录：

```text
%USERPROFILE%\Documents\Klei\OxygenNotIncluded\mods\Local\DoubaoAI
```

安装或更新 DLL 后必须完全退出并重新启动缺氧；Unity 不会热更新已经加载的 Mod 程序集。

构建：

```powershell
pnpm build:oni
```

发布包与安装清单：

```powershell
pnpm pack:oni
```

Harness 中的 `oxygen_not_included_mod_detect` / `oxygen_not_included_mod_install`
负责检测、校验下载、备份、安装和失败回滚。旧版 `config.json` 不会迁移，避免遗留直连模型 Key。
