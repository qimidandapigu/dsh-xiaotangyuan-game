using System;
using System.Reflection;
using Microsoft.Xna.Framework;
using StardewValley;

namespace StardewAgentMod;

internal sealed class CompanionLocator
{
    private FieldInfo? effectField;
    private PropertyInfo? positionProperty;
    private Type? effectType;

    public Vector2? TryGetWorldPosition()
    {
        try
        {
            if (Game1.player?.trinketItems is null || Game1.player.trinketItems.Count == 0)
                return null;
            object? trinket = Game1.player.trinketItems[0];
            if (trinket is null) return null;

            if (this.effectField is null)
            {
                Type? type = trinket.GetType();
                while (type is not null && this.effectField is null)
                {
                    this.effectField = type.GetField(
                        "_trinketEffect",
                        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance
                    );
                    type = type.BaseType;
                }
            }
            object? effect = this.effectField?.GetValue(trinket);
            if (effect is null) return null;
            if (this.effectType != effect.GetType())
            {
                this.effectType = effect.GetType();
                this.positionProperty = this.effectType.GetProperty("CompanionPosition");
            }
            return this.positionProperty?.GetValue(effect) is Vector2 position ? position : null;
        }
        catch
        {
            return null;
        }
    }
}
