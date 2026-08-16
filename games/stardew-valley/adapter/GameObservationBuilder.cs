using System;
using System.Linq;
using Microsoft.Xna.Framework;
using StardewValley;
using StardewValley.Monsters;
using StardewValley.TerrainFeatures;

namespace StardewAgentMod;

internal static class GameObservationBuilder
{
    public static object Capture()
    {
        Farmer player = Game1.player;
        GameLocation location = Game1.currentLocation;
        Vector2 playerTile = player.Tile;

        var inventory = player.Items
            .Where(item => item is not null)
            .GroupBy(item => item!.DisplayName)
            .Select(group => new { name = group.Key, count = group.Sum(item => Math.Max(1, item!.Stack)) })
            .Take(12)
            .ToArray();

        var nearbyNpcs = location.characters
            .OfType<NPC>()
            .Where(npc => !npc.IsMonster && Vector2.Distance(npc.Tile, playerTile) <= 12f)
            .OrderBy(npc => Vector2.Distance(npc.Tile, playerTile))
            .Take(8)
            .Select(npc => new
            {
                name = npc.Name,
                tile = new { x = (int)npc.Tile.X, y = (int)npc.Tile.Y },
                hearts = player.friendshipData.TryGetValue(npc.Name, out Friendship? friendship)
                    ? friendship.Points / 250 : 0
            })
            .ToArray();

        var monsters = location.characters
            .OfType<Monster>()
            .OrderBy(monster => Vector2.Distance(monster.Tile, playerTile))
            .Take(8)
            .Select(monster => new
            {
                name = monster.Name,
                health = monster.Health,
                distance = Math.Round(Vector2.Distance(monster.Tile, playerTile), 1)
            })
            .ToArray();

        int tilled = 0;
        int dry = 0;
        int crops = 0;
        int ripe = 0;
        foreach (var pair in location.terrainFeatures.Pairs)
        {
            TerrainFeature feature = pair.Value;
            if (feature is not HoeDirt dirt) continue;
            tilled++;
            if (dirt.state.Value == HoeDirt.dry) dry++;
            if (dirt.crop is null) continue;
            crops++;
            if (dirt.readyForHarvest()) ripe++;
        }

        string weather = Game1.isLightning ? "storm"
            : Game1.isSnowing ? "snow"
            : Game1.isRaining ? "rain"
            : "sunny";

        return new
        {
            schema = "xty.stardew.observation.v1",
            capturedAt = DateTimeOffset.UtcNow,
            game = new
            {
                year = Game1.year,
                season = Game1.currentSeason,
                day = Game1.dayOfMonth,
                time = Game1.timeOfDay,
                weather
            },
            player = new
            {
                name = player.Name,
                tile = new { x = (int)playerTile.X, y = (int)playerTile.Y },
                money = player.Money,
                stamina = (int)player.Stamina,
                maxStamina = (int)player.MaxStamina,
                health = player.health,
                maxHealth = player.maxHealth,
                currentItem = player.CurrentItem?.DisplayName,
                inventoryFreeSlots = player.freeSpotsInInventory(),
                inventory
            },
            location = new
            {
                id = location.NameOrUniqueName,
                type = location.GetType().Name,
                outdoors = location.IsOutdoors,
                objects = location.Objects.Count(),
                nearbyNpcs,
                monsters
            },
            farm = new { tilled, dry, crops, ripe },
            ui = new
            {
                menuOpen = Game1.activeClickableMenu is not null,
                eventRunning = Game1.eventUp,
                playerFree = player.CanMove
            },
            quests = player.questLog
                .Where(quest => quest is not null && !quest.completed.Value)
                .Take(8)
                .Select(quest => new { id = quest.id.Value, title = quest.questTitle })
                .ToArray()
        };
    }
}
