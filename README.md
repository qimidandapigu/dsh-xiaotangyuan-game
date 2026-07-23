# Don't Starve AI Mod

Give Chester a voice and enough context to talk about the current *Don't Starve Together* game.

The first vertical slice follows the interaction design of
[StardewAIChat](https://github.com/qimidandapigu/StardewAIChat): hold `V` to talk,
release to send microphone audio, the current game screenshot, and structured game
state to a multimodal model, then hear Chester's answer.

## What works

- Hold-to-talk microphone recording (`V` by default).
- Capture of the visible *Don't Starve Together* window.
- A Lua mod exports player, world, inventory, nearby-entity, and Chester state.
- An OpenAI-compatible API performs vision chat; voice can use compatible audio
  endpoints or the same Volcengine ASR/TTS backend as StardewAIChat.
- The latest screenshot and merged context are saved under `runtime/` for debugging.
- Chester displays the answer as an in-game speech bubble in locally hosted worlds.

This version targets Windows and *Don't Starve Together*. The in-game reply bridge is
intended for local/single-player hosting; voice and vision also work when joining a
remote server, but the remote server cannot display Chester's reply bubble unless it
also has access to the bridge file.

## Quick start

Requirements: Python 3.11+, *Don't Starve Together*, a vision chat endpoint, and either
compatible audio endpoints or a Volcengine voice key.

```powershell
git clone https://github.com/qimidandapigu/dont-starve-ai-mod.git
cd dont-starve-ai-mod
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
Copy-Item .env.example .env
notepad .env
```

To reuse an existing local StardewAIChat setup without printing its keys:

```powershell
.\scripts\import-stardew-config.ps1
```

To build the Windows launcher for development:

```powershell
.\scripts\build-launcher.ps1
```

To build the complete player ZIP without private credentials:

```powershell
.\scripts\build-player-package.ps1
```

For a private, trusted test group only, explicitly include the local `.env`:

```powershell
.\scripts\build-player-package.ps1 -IncludeLocalEnv
```

Send `dist/dont-starve-ai-mod-player.zip` to the player. The player extracts it
and runs `安装切斯特AI.exe`; it detects their game and installs everything to:

```text
<their DST folder>\mods\dont-starve-ai-mod
```

The installer creates `Steam启动项.txt` in that folder. The player copies
its single line into the Steam launch options for *Don't Starve Together*:

```text
"<their DST folder>\mods\dont-starve-ai-mod\ChesterAI.exe" %command%
```

Steam passes the original game command through `%command%`. `ChesterAI.exe`
automatically installs/enables the Lua mod, starts the game, and keeps the voice
bridge running until the game exits. No extra `--launch` flag is required.

Install the Lua mod into the detected Steam game directory:

```powershell
.\scripts\install-mod.ps1
```

In DST, open **Mods**, enable **Don't Starve AI Mod**, and enter or host a world. Then
start the sidecar:

```powershell
python -m dont_starve_ai_mod
```

Hold `V`, speak, and release. Press `Shift+V` to retry the most recently
recognised question without recording again. Press `Ctrl+C` in the terminal to stop.
The latest 10 question-and-answer pairs are saved in `runtime/conversation_history.json`.

## Configuration

Copy `.env.example` to `.env`. At minimum set `AI_API_KEY`. The defaults use the
standard `/v1/audio/transcriptions`, `/v1/chat/completions`, and `/v1/audio/speech`
routes. Override individual URLs for other compatible providers.

Useful diagnostics:

```powershell
# Verify API configuration, game directory, microphone, and window discovery.
python -m dont_starve_ai_mod --check

# Capture only; does not call any API.
python -m dont_starve_ai_mod --capture-once

# Test vision/chat/TTS without using the microphone.
python -m dont_starve_ai_mod --text "What should I do next?"
```

After a capture, inspect:

- `runtime/latest_screenshot.png` — exact image sent to the vision model.
- `runtime/latest_context.json` — structured game and window state.
- `runtime/chester.log` — sidecar activity and errors (secrets are never logged).
- `<DST>/data/unsafedata/dont_starve_ai_mod_lua.txt` — Lua bridge diagnostics,
  including input handler installation and `V` key events.

## Architecture

```text
DST Lua mod ──writes──> data/unsafedata/dont_starve_ai_mod_requests.json
                                      │
microphone ─┐                         v
game window ├──> Python sidecar ──> ASR + vision chat + TTS ──> speakers
            │                         │
            └─────────────────────────┴──writes reply──> Chester speech bubble
```

The Lua mod also refreshes `dont_starve_ai_mod_state.json` for diagnostics. Recording
commands are stored as an event array in `dont_starve_ai_mod_requests.json`, and the
Python sidecar consumes each event ID once. The Lua sandbox is kept free of network
and audio work. API keys stay only in the sidecar's local `.env` file, which is ignored
by Git.

## Development

```powershell
python -m unittest discover -s tests -v
python -m compileall -q src tests
```

The sidecar uses a `src/` package layout. The game mod lives in `game-mod/` and can be
copied repeatedly with `scripts/install-mod.ps1` during development. If the package is
not installed in editable mode, prefix development commands with `$env:PYTHONPATH='src'`.

## License

MIT
