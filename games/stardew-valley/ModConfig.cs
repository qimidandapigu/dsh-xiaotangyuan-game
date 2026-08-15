using StardewModdingAPI;

namespace StardewAgentMod;

internal sealed class ModConfig
{
    public string GatewayUrl { get; set; } = "ws://127.0.0.1:32145";

    public SButton ChatKey { get; set; } = SButton.T;
}
