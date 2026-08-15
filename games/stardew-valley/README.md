# XiaoTangYuan Game AI - Stardew Valley

The Stardew Valley SMAPI adapter for `dsh-xiaotangyuan-game`.

## Install

After installing the Harness plugin, tell DeepSeek Harness:

```text
小汤圆，帮我检测并安装星露谷 AI MOD
```

For a manual installation, download the newest `stardew-v*` release from this repository and extract its `StardewAgentMod` folder into the game's `Mods` directory.

## Use

Start Stardew Valley through SMAPI, load a save, and press `T`. Messages are sent over the loopback gateway to a game Agent running inside DeepSeek Harness.

## Compatibility

The SMAPI `UniqueID` remains `qimidandapigu.StardewAgent`, and the installation folder remains `StardewAgentMod`, so version `0.2.0` upgrades version `0.1.0` in place.
