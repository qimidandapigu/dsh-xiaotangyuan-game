using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Menus;

namespace StardewAgentMod;

public sealed class ModEntry : Mod
{
    private readonly ConcurrentQueue<Action> mainThreadActions = new();
    private CompanionLocator companion = null!;
    private SpeechBubble speechBubble = null!;
    private ModConfig config = null!;
    private GameAgentClient client = null!;
    private object? latestObservation;
    private bool textRequestInFlight;
    private bool observationInFlight;

    public override void Entry(IModHelper helper)
    {
        this.config = helper.ReadConfig<ModConfig>();
        this.companion = new CompanionLocator(helper, this.Monitor);
        this.speechBubble = new SpeechBubble(this.companion.TryGetWorldPosition);
        this.client = new GameAgentClient(this.config.GatewayUrl);
        this.client.AssistantPresented += text => this.mainThreadActions.Enqueue(() => this.speechBubble.Show(text));
        this.client.AssistantStatusChanged += (status, transcript) => this.mainThreadActions.Enqueue(() =>
        {
            if (status == "recording")
            {
                this.speechBubble.ShowStatus("正在听……");
                Game1.addHUDMessage(new HUDMessage("小汤圆正在听……", HUDMessage.newQuest_type));
            }
            else if (status == "thinking")
            {
                this.speechBubble.ShowStatus(string.IsNullOrWhiteSpace(transcript)
                    ? "正在思考……"
                    : $"听到：{transcript}\n正在思考……");
                Game1.addHUDMessage(new HUDMessage(
                    string.IsNullOrWhiteSpace(transcript) ? "小汤圆正在思考……" : $"你说：{transcript}",
                    HUDMessage.newQuest_type
                ));
            }
        });
        this.client.AssistantFailed += message => this.mainThreadActions.Enqueue(() =>
        {
            this.Monitor.Log($"XiaoTangYuan interaction failed: {message}", LogLevel.Warn);
            this.speechBubble.Show($"语音暂时失败：{message}");
            if (Context.IsWorldReady)
                Game1.addHUDMessage(new HUDMessage($"小汤圆：{message}", HUDMessage.error_type));
        });

        helper.Events.Input.ButtonPressed += this.OnButtonPressed;
        helper.Events.GameLoop.UpdateTicked += this.OnUpdateTicked;
        helper.Events.GameLoop.OneSecondUpdateTicked += this.OnOneSecondUpdateTicked;
        helper.Events.GameLoop.SaveLoaded += this.OnSaveLoaded;
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.Display.RenderedWorld += this.OnRenderedWorld;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;

        this.Monitor.Log(
            $"小汤圆星露谷适配器已加载。按 {this.config.TextChatKey} 输入文字；在游戏为前台时按住 V 进行 Harness 语音对话。",
            LogLevel.Info
        );
    }

    private void OnButtonPressed(object? sender, ButtonPressedEventArgs e)
    {
        if (e.Button != this.config.TextChatKey || !Context.IsWorldReady || this.textRequestInFlight)
            return;
        if (Game1.activeClickableMenu is not null) return;

        this.Helper.Input.Suppress(e.Button);
        Game1.activeClickableMenu = new NamingMenu(this.OnChatSubmitted, "和小汤圆对话", string.Empty);
    }

    private void OnChatSubmitted(string text)
    {
        text = text.Trim();
        if (text.Length == 0) return;

        this.latestObservation = GameObservationBuilder.Capture();
        object context = new { observation = this.latestObservation };
        this.textRequestInFlight = true;
        Game1.addHUDMessage(new HUDMessage("小汤圆正在观察和思考……", HUDMessage.newQuest_type));
        _ = this.SendTextChatAsync(text, context);
    }

    private async Task SendTextChatAsync(string text, object context)
    {
        try
        {
            using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(120));
            string reply = await this.client.SendChatAsync(text, context, timeout.Token).ConfigureAwait(false);
            this.mainThreadActions.Enqueue(() =>
            {
                this.textRequestInFlight = false;
                this.speechBubble.Show(reply);
            });
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"XiaoTangYuan text chat failed: {ex}", LogLevel.Error);
            this.mainThreadActions.Enqueue(() =>
            {
                this.textRequestInFlight = false;
                Game1.addHUDMessage(new HUDMessage(
                    "无法连接小汤圆，请确认 DeepSeek Harness 和插件已经启动。",
                    HUDMessage.error_type
                ));
            });
        }
    }

    private void OnOneSecondUpdateTicked(object? sender, OneSecondUpdateTickedEventArgs e)
    {
        if (!Context.IsWorldReady || this.observationInFlight) return;
        this.latestObservation = GameObservationBuilder.Capture();
        this.observationInFlight = true;
        _ = this.PublishObservationAsync(this.latestObservation);
    }

    private async Task PublishObservationAsync(object observation)
    {
        try
        {
            using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(10));
            await this.client.PublishObservationAsync(observation, timeout.Token).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[小汤圆] 状态上报暂时失败：{ex.Message}", LogLevel.Trace);
        }
        finally
        {
            this.mainThreadActions.Enqueue(() => this.observationInFlight = false);
        }
    }

    private void OnUpdateTicked(object? sender, UpdateTickedEventArgs e)
    {
        while (this.mainThreadActions.TryDequeue(out Action? action)) action();
    }

    private void OnRenderedWorld(object? sender, RenderedWorldEventArgs e)
    {
        if (!Context.IsWorldReady) return;
        this.speechBubble.Draw(e.SpriteBatch, this.config.BubbleYOffset);
    }

    private void OnSaveLoaded(object? sender, SaveLoadedEventArgs e)
    {
        this.companion.ApplyEnabled(this.config.ShowCompanion);
    }

    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        this.companion.ApplyEnabled(this.config.ShowCompanion);
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        this.textRequestInFlight = false;
        this.observationInFlight = false;
        this.latestObservation = null;
        this.speechBubble.Clear();
    }
}
