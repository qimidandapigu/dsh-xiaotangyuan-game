# Oxygen Not Included Adapter

`bridge/` is the C# Mod loaded by Oxygen Not Included. It owns only game-native work:
observations, cursor/duplicant identity, native chore execution, and the in-game fairy UI.

The TypeScript ONI Adapter lives in `adapter/` as its own installable Harness plugin. It
bridges this Mod to the local AIHarness Gateway and registers ONI-specific tools. The
generic Harness package does not depend on it, so other players do not download ONI code.

AI credentials, screenshot capture, ASR, TTS, memory, and model selection belong to
AIHarness, not to the Mod. The Bridge contains no direct model or speech client.

Build the bridge with:

```powershell
pnpm build:oni
```

Build the versioned Bridge ZIP and refresh its signed-hash distribution manifest with:

```powershell
pnpm pack:oni
```

Build the separately installable Harness Adapter package with:

```powershell
pnpm pack:oni-adapter
```

After the resulting `.release/oni/dsh-xiaotangyuan-game-oni-<version>.zip` is
published under the matching `oni-v<version>` GitHub Release, players can ask
Harness to detect and install the Mod. The installer downloads only this C#
Bridge; the TypeScript Adapter remains a separately installed Harness plugin.

Pass `-p:GameManagedDir=<ONI managed directory>` if the local Steam installation is not at
the configured path. Do not package `bin/`, `obj/`, `dist/`, logs, or a local `config.json`.
