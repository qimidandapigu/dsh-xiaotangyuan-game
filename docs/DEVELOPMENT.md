# 开发与发布

## 开发环境

- Node.js `22.19` 或更高。
- pnpm `10`。
- .NET SDK `8`，星露谷适配器目标为 `net6.0`。
- Windows x64 用于构建和验证 `XtyMediaHost.exe`。
- 本机安装 Stardew Valley 与 SMAPI 时，可进行真实游戏验证；普通 TypeScript 测试不依赖游戏启动。

## 职责边界

```text
apps/harness-plugin
  通用 Agent、模型、视觉、ASR/TTS、媒体、安装器

apps/windows-media-host
  Windows 麦克风录制、前台进程限制、V 热键、WAV 播放

games/stardew-valley/adapter
  SMAPI 状态、T 文字输入、Gateway、游戏内气泡

games/stardew-valley/content-pack
  小汤圆图片和 TrinketTinker 数据
```

不要把 Provider SDK、API Key、Prompt、长期记忆、麦克风或扬声器逻辑放回游戏适配器。

## 常用命令

```powershell
pnpm install
pnpm check
pnpm build:stardew
pnpm build:media
pnpm pack:plugin
```

命令含义：

| 命令 | 输出或验证 |
|---|---|
| `pnpm check` | TypeScript 编译与 Vitest 测试 |
| `pnpm build:stardew` | `StardewAgentMod.dll` 与 SMAPI MOD zip |
| `pnpm build:media` | 自包含 Windows x64 `XtyMediaHost.exe` |
| `pnpm pack:plugin` | Harness `.tgz`，必须包含媒体 Host |

## 发布物边界

Harness Release：

```text
qimidandapigu-dsh-xiaotangyuan-game-<plugin-version>.tgz
```

星露谷 Release：

```text
dsh-xiaotangyuan-game-stardew-<adapter-version>.zip
├─ StardewAgentMod/
└─ XiaoTangYuanCompanion/
```

禁止把 Content Patcher 或 TrinketTinker 二进制复制进第一方 Release。安装器只能使用经过审核的官方 URL、固定大小和 SHA-256。

## 版本规则

- Harness 插件修改：递增 `package.json` 与 `apps/harness-plugin/package.json`。
- 星露谷 DLL 或内容包修改：同时递增适配器清单、内容包清单、第一方 zip、Release tag 和 distribution 清单。
- 协议发生不兼容变化：新增协议版本，不能静默改变 `protocol/v1` 语义。
- 文档必须列出插件版本和适配器版本，不能假设二者相同。

## 安装器变更检查表

安装器相关改动至少验证：

1. 静态清单 schema、URL、大小和 SHA-256。
2. 官方组件压缩包顶层目录与 `manifest.json`。
3. 安装前后 `UniqueID` 和版本。
4. 旧 `StardewAgentMod/config.json` 保留。
5. 中途失败时事务回滚。
6. 备份路径位于游戏根目录 `.xiaotangyuan-backups`，不在 `Mods`。
7. 旧版遗留备份只迁移小汤圆管理的组件。
8. 隔离假游戏目录的完整下载、解压和升级测试。

构建成功不等于游戏内验证成功。发布后仍需通过 SMAPI 重启游戏，并检查 `SMAPI-latest.txt` 和一次真实 T/V 对话。

## 发布前检查表

- 工作树中不包含研究下载、临时包或用户的无关修改。
- `pnpm check` 通过。
- 星露谷代码变更时 `pnpm build:stardew` 为 0 警告、0 错误。
- 插件包中存在 `media/windows-x64/XtyMediaHost.exe`。
- Release 资产的远端大小和 digest 与本地一致。
- GitHub `main` 已包含生成该资产的源提交。
- 正式 Harness profile 升级后，确认 `3080` 与 `32145` 正常监听。
