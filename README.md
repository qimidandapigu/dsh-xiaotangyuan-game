# dsh-game-agent

A DeepSeek Harness plugin that exposes a loopback WebSocket gateway for game mods. The first adapter is `stardew-agent-mod`.

## Current demo

```text
Stardew Valley SMAPI mod
  -> ws://127.0.0.1:32145 (JSON-RPC 2.0)
  -> dsh-game-agent
  -> DeepSeek Harness Agent
  -> reply shown inside Stardew Valley
```

The gateway binds only to loopback. Version `0.2.0` supports complete text replies plus automatic Stardew Valley MOD detection and installation; token streaming and in-game action tools are deferred.

## Install the Stardew MOD through conversation

Once this plugin is loaded, tell DeepSeek Harness:

```text
帮我安装星露谷 AI MOD
```

The model can call two native tools:

- `game_mod_detect`: finds Steam's Stardew Valley directory, SMAPI, and the installed MOD version.
- `game_mod_install`: downloads the latest `stardew-agent-mod` GitHub Release through the GitHub asset API, verifies `SHA256SUMS.txt`, backs up an existing copy, installs it, and verifies its manifest.

The install tool only runs after an explicit installation request. SMAPI must already be installed. Windows is currently verified; macOS and common Linux Steam locations are searched on a best-effort basis. `gamePath` can be supplied when automatic detection fails.

## Develop

Requirements: Node.js 22.19+ and pnpm.

```bash
pnpm install
pnpm check
```

## Install into a local DeepSeek Harness profile

Install the published GitHub package into the Web profile:

```powershell
dsh plugin --profile web add "https://github.com/qimidandapigu/dsh-game-agent/releases/download/v0.2.0/qimidandapigu-dsh-game-agent-0.2.0.tgz"
dsh web
```

Or develop from this checkout:

```bash
dsh plugin --profile game add .
dsh --profile game
```

If `dsh` is not installed globally, use the matching `npx @deepseek-ai/dsh@0.1.0-rc.6 ...` command. DeepSeek Harness is currently a developer preview, so this plugin pins its tested API generation to `0.1.0-rc.6`.

Configure a model and credentials in DeepSeek Harness before sending chat messages. The plugin uses the profile's selected default model; it does not store a separate API key.

The GitHub Release command above is the supported installation route until the npm package is published.

## Protocol

The game mod connects to `ws://127.0.0.1:32145`, calls `adapter.hello`, then sends:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "chat.send",
  "params": {
    "text": "你好",
    "context": {
      "playerName": "Farmer",
      "location": "Farm",
      "nearbyNpc": "Abigail"
    }
  }
}
```

The result contains `reply` and `sessionId`.

## License

MIT
