# dsh-xiaotangyuan-game

**小汤圆游戏 AI（XiaoTangYuan Game AI）** is a single-repository DeepSeek Harness integration for game MOD installation and model-backed in-game agents.

```text
Game MOD
  -> ws://127.0.0.1:32145 (JSON-RPC 2.0)
  -> dsh-xiaotangyuan-game
  -> DeepSeek Harness Agent
  -> reply shown inside the game
```

The Harness plugin contains the gateway, installer tools, and game integration logic. Game MOD binaries are not bundled into the plugin; they are downloaded on demand from game-specific releases in this repository.

## Repository layout

```text
src/                       DeepSeek Harness plugin and shared runtime
src/games/stardew-valley/  Harness-side detection and installation
test/                      TypeScript tests
games/stardew-valley/      Stardew Valley SMAPI MOD source
```

Additional games will be added under `games/` without creating another repository.

## Install the Harness plugin

```powershell
dsh plugin --profile web add "https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/plugin-v0.3.0/qimidandapigu-dsh-xiaotangyuan-game-0.3.0.tgz"
dsh web
```

If the earlier `@qimidandapigu/dsh-game-agent` package is installed, remove it before adding this renamed package so that two gateways do not compete for port `32145`.

Then tell DeepSeek Harness:

```text
小汤圆，帮我检测并安装星露谷 AI MOD
```

The model calls `game_mod_detect` and `game_mod_install`. The installer finds Steam and SMAPI, downloads the latest `stardew-v*` release, verifies `SHA256SUMS.txt`, backs up an existing installation, and validates the installed manifest.

## Develop

Requirements: Node.js 22.19+, pnpm, .NET SDK, Stardew Valley, and SMAPI.

```powershell
pnpm install
pnpm check
dotnet build games/stardew-valley/StardewAgentMod.csproj -c Release
```

Automatic MOD deployment is disabled during builds.

## Protocol

The game MOD connects to `ws://127.0.0.1:32145`, calls `adapter.hello`, and sends `chat.send` JSON-RPC requests. The result contains `reply` and `sessionId`.

Version `0.3.0` supports complete text replies and Stardew Valley MOD installation. Token streaming, voice, screenshots, and in-game action tools are future work.

## License

MIT
