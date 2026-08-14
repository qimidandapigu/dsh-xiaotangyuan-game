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

The gateway binds only to loopback. Version `0.1.0` supports complete text replies; token streaming and game tools are intentionally deferred.

## Develop

Requirements: Node.js 22.19+ and pnpm.

```bash
pnpm install
pnpm check
```

## Install into a local DeepSeek Harness profile

From this checkout:

```bash
dsh plugin --profile game add .
dsh --profile game
```

If `dsh` is not installed globally, use the matching `npx @deepseek-ai/dsh@0.1.0-rc.6 ...` command. DeepSeek Harness is currently a developer preview, so this plugin pins its tested API generation to `0.1.0-rc.6`.

Configure a model and credentials in DeepSeek Harness before sending chat messages. The plugin uses the profile's selected default model; it does not store a separate API key.

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
