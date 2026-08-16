using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewModdingAPI;
using StardewValley;

namespace StardewAgentMod;

/// <summary>游戏内的小汤圆形象。素材随适配器安装，不依赖其他 MOD。</summary>
internal sealed class CompanionAvatar
{
    private const int FrameSize = 32;
    private static readonly int[] FacingFrames = { 2, 1, 0, 3 };

    private readonly Texture2D texture;
    private Vector2 worldPosition;
    private bool initialized;

    public CompanionAvatar(Texture2D texture)
    {
        this.texture = texture;
    }

    public Vector2? WorldPosition => this.initialized ? this.HoveredPosition() : null;

    public void Update()
    {
        Farmer? player = Game1.player;
        if (!Context.IsWorldReady || player is null) return;

        Vector2 playerCenter = player.Position + new Vector2(32f, 32f);
        float side = player.FacingDirection == 3 ? 1f : -1f;
        Vector2 target = playerCenter + new Vector2(72f * side, -8f);

        if (!this.initialized || Vector2.DistanceSquared(this.worldPosition, target) > 512f * 512f)
        {
            this.worldPosition = target;
            this.initialized = true;
            return;
        }

        float elapsed = (float)(Game1.currentGameTime?.ElapsedGameTime.TotalSeconds ?? 1d / 60d);
        float amount = Math.Clamp(elapsed * 7f, 0f, 1f);
        this.worldPosition = Vector2.Lerp(this.worldPosition, target, amount);
    }

    public void Draw(SpriteBatch batch, float scale)
    {
        Farmer? player = Game1.player;
        if (!Context.IsWorldReady || !this.initialized || player is null) return;

        int facing = Math.Clamp(player.FacingDirection, 0, FacingFrames.Length - 1);
        Rectangle source = new(FacingFrames[facing] * FrameSize, 0, FrameSize, FrameSize);
        Vector2 position = this.HoveredPosition();
        Vector2 screen = Game1.GlobalToLocal(Game1.viewport, position);
        float depth = Math.Clamp((position.Y + FrameSize) / 10000f, 0f, 1f);

        batch.Draw(
            this.texture,
            screen,
            source,
            Color.White,
            0f,
            new Vector2(FrameSize / 2f, FrameSize / 2f),
            Math.Clamp(scale, 0.5f, 4f),
            SpriteEffects.None,
            depth
        );
    }

    public void Reset()
    {
        this.initialized = false;
        this.worldPosition = Vector2.Zero;
    }

    private Vector2 HoveredPosition()
    {
        double seconds = Game1.currentGameTime?.TotalGameTime.TotalSeconds ?? 0d;
        return this.worldPosition + new Vector2(0f, (float)Math.Sin(seconds * 3.2d) * 5f);
    }
}
