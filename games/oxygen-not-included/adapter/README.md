# Oxygen Not Included Adapter

这是可独立安装、选择性加载的 DeepSeek Harness 插件，不是通用 Harness
核心的内置模块。只有选择《缺氧》的玩家需要下载它。

它负责：

- 缺氧角色知识与 `oni_move` / `oni_dig` / `oni_dig_path` / `oni_build` 工具；
- Harness JSON-RPC 与 C# Bridge 文件协议之间的翻译；
- `oxygen_not_included_mod_detect` / `oxygen_not_included_mod_install`安装工具；
- 缺氧 Bridge Release 的下载、SHA-256 校验、备份、安装和回滚。

它不读取游戏程序集，不保存模型凭据，也不包含模型、语音、截图或记忆实现。

打包独立 Adapter：

```powershell
pnpm pack:oni-adapter
```
