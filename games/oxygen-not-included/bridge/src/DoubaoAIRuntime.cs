using System;
using System.IO;
using DoubaoAI.ONI.Assets;
using DoubaoAI.ONI.Commands;
using DoubaoAI.ONI.GameState;
using DoubaoAI.ONI.Harness;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace DoubaoAI.ONI
{
    // Thin game Bridge. AI models, media, memory and credentials live in AIHarness.
    internal sealed class DoubaoAIRuntime : MonoBehaviour
    {
        private OniHarnessBridge _bridge;
        private Texture2D _sprite;
        private Texture2D _fallbackSprite;
        private Texture2D _halo;
        private Font _font;
        private GUIStyle _bodyStyle;
        private GUIStyle _inputStyle;
        private GUIStyle _buttonStyle;
        private GUIStyle _statusStyle;
        private Rect _panelRect;
        private string _input = string.Empty;
        private string _reply = "我是精灵。把鼠标指到目标位置，可以问攻略，也可以让我指挥复制人。";
        private string _status = "正在连接 AIHarness…";
        private bool _panelOpen;
        private bool _busy;
        private float _bubbleUntil;
        private float _nextDangerScanAt;
        private float _lastDangerAlertAt;
        private float _nextAutoChatAt;
        private string _lastDangerSignature;

        private void Awake()
        {
            PlayerCommandExecutor.Reset();
            ModConfig config = ConfigManager.Load(ModPaths.ContentPath);
            _bridge = new OniHarnessBridge(config.HarnessBridgeRoot);
            _bridge.Notification += OnHarnessNotification;
            _bridge.ToolExecution += ExecuteHarnessTool;
            string assets = Path.Combine(ModPaths.ContentPath, "assets");
            _sprite = TextureLoader.LoadPng(Path.Combine(assets, "doubao_companion.png"));
            _fallbackSprite = TextureLoader.LoadPng(Path.Combine(assets, "doubao_t.png"));
            _halo = TextureLoader.CreateHalo(96);
            try { _font = Font.CreateDynamicFontFromOSFont("Microsoft YaHei UI", 18); } catch { _font = null; }
            _panelRect = new Rect(Mathf.Max(20, Screen.width - 540), 110, 500, 500);
            _bubbleUntil = Time.unscaledTime + 8f;
            ScheduleNextAutoChat();
        }

        private void Update()
        {
            PlayerCommandExecutor.Tick();
            _bridge.Tick();
            GameSnapshot snapshot = SafeCollectSnapshot();
            PlayerCommandSnapshot command = SafeCollectCommandSnapshot();
            _bridge.PublishState(snapshot, command);
            ModConfig config = ConfigManager.Current;
            if (config.DangerAlertsEnabled && Time.unscaledTime >= _nextDangerScanAt)
            {
                _nextDangerScanAt = Time.unscaledTime + 2f;
                PlayerDangerEvent danger = PlayerDangerDetector.Detect();
                if (danger == null) _lastDangerSignature = null;
                else if (!_busy && (danger.Signature != _lastDangerSignature || Time.unscaledTime - _lastDangerAlertAt >= config.DangerAlertCooldownSeconds))
                {
                    _lastDangerSignature = danger.Signature;
                    _lastDangerAlertAt = Time.unscaledTime;
                    _busy = true;
                    _status = "正在生成紧急提醒…";
                    _bridge.Compose(danger.Prompt, snapshot, command);
                }
            }
            if (!_busy && !_panelOpen && config.AutoChatEnabled && Time.unscaledTime >= _nextAutoChatAt)
            {
                ScheduleNextAutoChat();
                _busy = true;
                _status = "精灵正在观察殖民地…";
                _bridge.Compose("玩家已经一段时间没说话了。结合当前殖民地状态说一句简短、自然、有用的话；没有要紧事就随口聊聊。", snapshot, command);
            }
            if (_panelOpen && Input.GetKeyDown(KeyCode.Escape)) _panelOpen = false;
        }

        private PlayerCommandExecutionResult ExecuteHarnessTool(string name, JObject args)
        {
            var plan = new PlayerCommandPlan
            {
                Mode = "command",
                ActorScope = ((string)args["actorScope"] ?? "specific").Trim().ToLowerInvariant(),
                ActorId = (int?)args["actorId"] ?? -1,
                TargetCell = (int?)args["targetCell"] ?? Grid.InvalidCell,
                Urgent = (bool?)args["urgent"] ?? false,
                BuildingKey = ((string)args["buildingKey"] ?? string.Empty).Trim().ToLowerInvariant()
            };
            if (name == "oni_move") plan.Action = "move";
            else if (name == "oni_dig") plan.Action = "dig";
            else if (name == "oni_dig_path") plan.Action = "dig_path";
            else if (name == "oni_build") plan.Action = "build";
            else return new PlayerCommandExecutionResult { Success = false, Reply = "未知缺氧工具：" + name };
            return PlayerCommandExecutor.Execute(plan);
        }

        private void OnHarnessNotification(string method, string text)
        {
            if (method == "gateway.ready") { _status = "AIHarness 已连接"; return; }
            if (method == "assistant.status") { _status = text == "recording" ? "正在听你说话…" : "AIHarness 正在思考…"; return; }
            if (method == "assistant.present")
            {
                _busy = false; _status = "回答完成";
                _reply = string.IsNullOrWhiteSpace(text) ? "这次没有生成有效回复。" : text;
                _bubbleUntil = Time.unscaledTime + 12f; return;
            }
            if (method == "assistant.error")
            {
                _busy = false; _status = "AIHarness 请求失败";
                _reply = string.IsNullOrWhiteSpace(text) ? "请确认 AIHarness 已启动。" : text;
                _bubbleUntil = Time.unscaledTime + 10f;
            }
        }

        private void OnGUI()
        {
            EnsureStyles();
            ModConfig config = ConfigManager.Current;
            float right = Mathf.Clamp(config.FairyRightOffset, 0, Mathf.Max(0, Screen.width - 80));
            float top = Mathf.Clamp(config.FairyTopOffset, 16, Mathf.Max(16, Screen.height - 100));
            Rect anchor = new Rect(Screen.width - right - 72, top, 72, 72);
            if (_halo != null) GUI.DrawTexture(new Rect(anchor.x - 12, anchor.y - 12, 96, 96), _halo, ScaleMode.ScaleToFit, true);
            Texture2D shown = _sprite != null ? _sprite : _fallbackSprite;
            if (shown != null) GUI.DrawTexture(anchor, shown, ScaleMode.ScaleToFit, true);
            if (GUI.Button(anchor, GUIContent.none, GUIStyle.none)) _panelOpen = !_panelOpen;
            if (!_panelOpen && Time.unscaledTime < _bubbleUntil && !string.IsNullOrWhiteSpace(_reply))
            {
                Rect bubble = new Rect(Mathf.Max(20, anchor.x - 340), anchor.y + 5, 320, 90);
                GUI.Box(bubble, GUIContent.none);
                GUI.Label(new Rect(bubble.x + 12, bubble.y + 10, bubble.width - 24, bubble.height - 20), _reply, _bodyStyle);
            }
            if (_panelOpen) _panelRect = GUI.Window(854721, _panelRect, DrawPanel, "缺氧 AI 精灵");
        }

        private void DrawPanel(int id)
        {
            GUI.Label(new Rect(20, 42, 460, 28), _status, _statusStyle);
            GUI.Box(new Rect(20, 78, 460, 250), GUIContent.none);
            GUI.Label(new Rect(34, 92, 432, 222), _reply, _bodyStyle);
            _input = GUI.TextArea(new Rect(20, 344, 460, 72), _input, 600, _inputStyle);
            bool send = GUI.Button(new Rect(350, 432, 130, 36), _busy ? "思考中…" : "发送", _buttonStyle);
            if (GUI.Button(new Rect(20, 432, 128, 36), "重载配置", _buttonStyle)) ConfigManager.Load(ModPaths.ContentPath);
            Event current = Event.current;
            if (current.type == EventType.KeyDown && current.keyCode == KeyCode.Return && (current.control || current.command)) { send = true; current.Use(); }
            if (send && !_busy && !string.IsNullOrWhiteSpace(_input))
            {
                string text = _input.Trim(); _input = string.Empty; _busy = true;
                _status = "正在交给 AIHarness 思考…"; ScheduleNextAutoChat();
                _bridge.SendChat(text, SafeCollectSnapshot(), SafeCollectCommandSnapshot());
            }
            GUI.DragWindow(new Rect(0, 0, 500, 36));
        }

        private static GameSnapshot SafeCollectSnapshot()
        {
            try { return GameSnapshotCollector.Collect(); }
            catch (Exception ex) { return new GameSnapshot { PromptContext = "采集结构化游戏信息失败：" + ex.Message }; }
        }

        private static PlayerCommandSnapshot SafeCollectCommandSnapshot()
        {
            try { return PlayerCommandContextCollector.Collect(); }
            catch { return new PlayerCommandSnapshot(); }
        }

        private void ScheduleNextAutoChat() { _nextAutoChatAt = Time.unscaledTime + ConfigManager.Current.AutoChatIntervalSeconds; }

        private void EnsureStyles()
        {
            if (_bodyStyle != null) return;
            Font selected = _font != null ? _font : GUI.skin.font;
            _bodyStyle = new GUIStyle(GUI.skin.label) { font = selected, fontSize = 17, wordWrap = true, normal = { textColor = Color.white } };
            _inputStyle = new GUIStyle(GUI.skin.textArea) { font = selected, fontSize = 17, wordWrap = true, padding = new RectOffset(10, 10, 8, 8) };
            _buttonStyle = new GUIStyle(GUI.skin.button) { font = selected, fontSize = 16, fontStyle = FontStyle.Bold };
            _statusStyle = new GUIStyle(GUI.skin.label) { font = selected, fontSize = 14, normal = { textColor = new Color(0.65f, 0.9f, 1f) } };
        }

        private void OnDestroy()
        {
            PlayerCommandExecutor.Reset();
            if (_bridge != null) _bridge.Dispose();
            if (_sprite != null) Destroy(_sprite);
            if (_fallbackSprite != null) Destroy(_fallbackSprite);
            if (_halo != null) Destroy(_halo);
            if (_font != null) Destroy(_font);
        }
    }
}
