using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Menus;

namespace StardewAgentMod;

public sealed class ModEntry : Mod
{
    private readonly ConcurrentQueue<Action> mainThreadActions = new();
    private ModConfig config = null!;
    private GameAgentClient client = null!;
    private bool requestInFlight;

    public override void Entry(IModHelper helper)
    {
        this.config = helper.ReadConfig<ModConfig>();
        this.client = new GameAgentClient(this.config.GatewayUrl);

        helper.Events.Input.ButtonPressed += this.OnButtonPressed;
        helper.Events.GameLoop.UpdateTicked += this.OnUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;

        this.Monitor.Log(
            $"XiaoTangYuan Game AI loaded. Press {this.config.ChatKey} to talk through DeepSeek Harness.",
            LogLevel.Info
        );
    }

    private void OnButtonPressed(object? sender, ButtonPressedEventArgs e)
    {
        if (e.Button != this.config.ChatKey || !Context.IsWorldReady || this.requestInFlight)
            return;
        if (Game1.activeClickableMenu is not null)
            return;

        this.Helper.Input.Suppress(e.Button);
        Game1.activeClickableMenu = new NamingMenu(this.OnChatSubmitted, "和小汤圆对话", string.Empty);
    }

    private void OnChatSubmitted(string text)
    {
        text = text.Trim();
        if (text.Length == 0)
            return;

        object context = this.CaptureContext();
        this.requestInFlight = true;
        Game1.addHUDMessage(new HUDMessage("小汤圆正在思考……", HUDMessage.newQuest_type));
        _ = this.SendChatAsync(text, context);
    }

    private object CaptureContext()
    {
        NPC? nearbyNpc = Game1.currentLocation.characters
            .OfType<NPC>()
            .OrderBy(npc => Vector2.Distance(npc.Tile, Game1.player.Tile))
            .FirstOrDefault();

        return new
        {
            playerName = Game1.player.Name,
            location = Game1.currentLocation.NameOrUniqueName,
            date = $"Year {Game1.year}, {Game1.currentSeason}, day {Game1.dayOfMonth}",
            time = Game1.getTimeOfDayString(Game1.timeOfDay),
            nearbyNpc = nearbyNpc?.Name
        };
    }

    private async Task SendChatAsync(string text, object context)
    {
        try
        {
            using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(120));
            string reply = await this.client.SendChatAsync(text, context, timeout.Token).ConfigureAwait(false);
            this.mainThreadActions.Enqueue(() =>
            {
                this.requestInFlight = false;
                Game1.drawObjectDialogue(reply);
            });
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"XiaoTangYuan chat failed: {ex}", LogLevel.Error);
            this.mainThreadActions.Enqueue(() =>
            {
                this.requestInFlight = false;
                Game1.addHUDMessage(new HUDMessage(
                    "无法连接小汤圆，请确认 dsh-xiaotangyuan-game 已启动。",
                    HUDMessage.error_type
                ));
            });
        }
    }

    private void OnUpdateTicked(object? sender, UpdateTickedEventArgs e)
    {
        while (this.mainThreadActions.TryDequeue(out Action? action))
            action();
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        this.requestInFlight = false;
    }
}
