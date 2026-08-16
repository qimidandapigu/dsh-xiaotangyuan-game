using System;
using System.Reflection;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Delegates;
using StardewValley.Objects.Trinkets;
using StardewValley.Triggers;

namespace StardewAgentMod;

internal sealed class CompanionLocator
{
    private const string CompanionItemId = "(TR)qimidandapigu.XiaoTangYuanCompanion_Companion";
    private const string EquipAction = "mushymato.TrinketTinker_EquipHiddenTrinket";
    private const string UnequipAction = "mushymato.TrinketTinker_UnequipHiddenTrinket";

    private readonly IModHelper helper;
    private readonly IMonitor monitor;
    private PropertyInfo? positionProperty;
    private Type? effectType;

    public CompanionLocator(IModHelper helper, IMonitor monitor)
    {
        this.helper = helper;
        this.monitor = monitor;
    }

    public void ApplyEnabled(bool enabled)
    {
        if (!Context.IsWorldReady || Game1.player is null) return;
        if (!this.helper.ModRegistry.IsLoaded("mushymato.TrinketTinker"))
        {
            this.monitor.Log("TrinketTinker 未加载，无法创建小汤圆同伴。", LogLevel.Warn);
            return;
        }

        if (enabled)
        {
            if (!this.IsEquipped())
                this.RunAction($"{EquipAction} {CompanionItemId} 0 0 -1 false");
            return;
        }

        for (int attempt = 0; attempt < 8 && this.IsEquipped(); attempt++)
            this.RunAction($"{UnequipAction} {CompanionItemId}");
    }

    public Vector2? TryGetWorldPosition()
    {
        try
        {
            foreach (Trinket? trinket in Game1.player?.trinketItems ?? [])
            {
                if (trinket?.QualifiedItemId != CompanionItemId) continue;
                object? effect = trinket.GetEffect();
                if (effect is null) continue;
                if (this.effectType != effect.GetType())
                {
                    this.effectType = effect.GetType();
                    this.positionProperty = this.effectType.GetProperty("CompanionPosOff")
                        ?? this.effectType.GetProperty("CompanionPosition");
                }
                if (this.positionProperty?.GetValue(effect) is Vector2 position) return position;
            }
            return null;
        }
        catch
        {
            return null;
        }
    }

    private bool IsEquipped()
    {
        if (Game1.player?.trinketItems is null) return false;
        foreach (Trinket? trinket in Game1.player.trinketItems)
        {
            if (trinket?.QualifiedItemId == CompanionItemId) return true;
        }
        return false;
    }

    private void RunAction(string actionText)
    {
        try
        {
            CachedAction action = TriggerActionManager.ParseAction(actionText);
            TriggerActionContext context = new(
                "qimidandapigu.StardewAgent_Companion",
                [],
                null,
                []
            );
            if (!TriggerActionManager.TryRunAction(action, context, out string error, out Exception exception))
                this.monitor.Log($"小汤圆同伴组件操作失败：{error} {exception?.Message}", LogLevel.Warn);
        }
        catch (Exception ex)
        {
            this.monitor.Log($"小汤圆同伴组件操作失败：{ex.Message}", LogLevel.Warn);
        }
    }
}
