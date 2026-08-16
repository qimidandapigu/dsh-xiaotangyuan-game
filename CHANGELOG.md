# 更新记录

本项目分别发布 Harness 插件和游戏适配器；两条版本线独立递增。

## Harness 插件 0.6.1 - 未发布

- 将饥荒 Lua Mod、Python Adapter、Jingling 动画、测试和构建历史统一迁入 `games/dont-starve-together`，停止双仓库开发。
- 增加根目录 `check:dst`、`build:dst`，玩家包构建后自动刷新同仓库发布清单的大小与 SHA-256。
- 增加《饥荒联机版》检测、固定清单校验、事务安装、备份回滚和 Steam 启动项生成。
- 通用媒体层按已注册游戏进程截取客户窗口，供星露谷、饥荒和后续游戏复用。
- 增加 `chat.retry` 与一次性 `assistant.compose`，分别支持重试和不污染主会话的游戏提醒。
- 增加自动玩家反馈工具：模型整理明确建议，官方 Harness 使用 HMAC 签名提交到私有 GitHub Issues 接收端。
- 增加可选缺氧 Adapter 与独立发布清单；游戏专属知识和动作不进入通用插件。
- 完善饥荒、缺氧、反馈、安全边界和开发版安装文档。

## Harness 插件 0.5.1 - 2026-08-16

- 修复升级备份留在 `Mods` 后被 SMAPI 识别为重复 MOD 的问题。
- 新备份改到游戏根目录 `.xiaotangyuan-backups`。
- 自动迁移旧安装器遗留的小汤圆相关备份，不移动其他 MOD。
- 增加备份迁移与路径保护测试。
- 继续内置 Windows x64 麦克风与音频播放 Host。

## 星露谷适配器 0.5.0 - 2026-08-16

- 将宠物资源加载交给 Content Patcher。
- 将宠物跟随、动画和渲染交给 TrinketTinker。
- 新增独立 `XiaoTangYuanCompanion` 内容包。
- AI 适配器只保留游戏状态、Gateway、文字输入和游戏内回复呈现。
- Harness 安装器自动安装并校验两个第三方组件。

## Harness 插件 0.4.2 - 2026-08-16

- 完成 Windows 媒体 Host 打包。
- 支持按住说话、ASR、Agent 回复、TTS 和游戏音频播放链路。
- 支持 DSH 凭据引用和多模态模型路由。

更早版本属于单仓库整合和原型阶段，不作为当前安装入口。
