namespace DoubaoAI.ONI
{
    internal sealed class ModConfig
    {
        public string HarnessBridgeRoot { get; set; } = string.Empty;
        public bool AutoChatEnabled { get; set; } = true;
        public int AutoChatIntervalSeconds { get; set; } = 60;
        public bool DangerAlertsEnabled { get; set; } = true;
        public int DangerAlertCooldownSeconds { get; set; } = 45;
        public int FairyRightOffset { get; set; } = 520;
        public int FairyTopOffset { get; set; } = 100;

        public void Normalize()
        {
            AutoChatIntervalSeconds = System.Math.Max(30, System.Math.Min(1800, AutoChatIntervalSeconds));
            DangerAlertCooldownSeconds = System.Math.Max(15, System.Math.Min(600, DangerAlertCooldownSeconds));
            FairyRightOffset = System.Math.Max(0, System.Math.Min(2000, FairyRightOffset));
            FairyTopOffset = System.Math.Max(16, System.Math.Min(1000, FairyTopOffset));
            if (HarnessBridgeRoot == null) HarnessBridgeRoot = string.Empty;
        }
    }
}
