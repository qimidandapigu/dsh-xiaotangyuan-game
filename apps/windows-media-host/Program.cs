using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using NAudio.Wave;

namespace XtyMediaHost;

internal static class Protocol
{
    private static readonly object OutputLock = new();

    public static void Send(object payload)
    {
        lock (OutputLock)
        {
            Console.Out.WriteLine(JsonSerializer.Serialize(payload));
            Console.Out.Flush();
        }
    }

    public static void Error(string message) => Send(new { type = "error", message });
}

internal sealed class AudioDevices : IDisposable
{
    private readonly object gate = new();
    private WaveInEvent? recorder;
    private WaveFileWriter? writer;
    private MemoryStream? recording;
    private int recordingProcessId;

    public bool IsRecording
    {
        get
        {
            lock (this.gate) return this.recorder is not null;
        }
    }

    public void StartRecording(int processId)
    {
        lock (this.gate)
        {
            if (this.recorder is not null) return;
            this.recordingProcessId = processId;
            this.recording = new MemoryStream();
            this.recorder = new WaveInEvent
            {
                DeviceNumber = 0,
                WaveFormat = new WaveFormat(16000, 16, 1),
                BufferMilliseconds = 100
            };
            this.writer = new WaveFileWriter(this.recording, this.recorder.WaveFormat);
            this.recorder.DataAvailable += this.OnDataAvailable;
            this.recorder.RecordingStopped += this.OnRecordingStopped;
            this.recorder.StartRecording();
        }
        Protocol.Send(new { type = "recording.started", processId });
    }

    public void StopRecording()
    {
        lock (this.gate) this.recorder?.StopRecording();
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        lock (this.gate) this.writer?.Write(e.Buffer, 0, e.BytesRecorded);
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        byte[]? wav = null;
        int processId;
        lock (this.gate)
        {
            processId = this.recordingProcessId;
            try
            {
                this.writer?.Dispose();
                wav = this.recording?.ToArray();
            }
            finally
            {
                if (this.recorder is not null)
                {
                    this.recorder.DataAvailable -= this.OnDataAvailable;
                    this.recorder.RecordingStopped -= this.OnRecordingStopped;
                    this.recorder.Dispose();
                }
                this.recorder = null;
                this.writer = null;
                this.recording?.Dispose();
                this.recording = null;
            }
        }

        if (e.Exception is not null)
        {
            Protocol.Error($"麦克风录制失败：{e.Exception.Message}");
            return;
        }
        if (wav is null || wav.Length <= 44) return;
        Protocol.Send(new
        {
            type = "recording.completed",
            processId,
            mediaType = "audio/wav",
            audioBase64 = Convert.ToBase64String(wav)
        });
    }

    public async Task PlayAsync(byte[] wav)
    {
        using var stream = new MemoryStream(wav, writable: false);
        using var reader = new WaveFileReader(stream);
        using var output = new WaveOutEvent();
        var stopped = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        output.PlaybackStopped += (_, e) =>
        {
            if (e.Exception is null) stopped.TrySetResult();
            else stopped.TrySetException(e.Exception);
        };
        output.Init(reader);
        output.Play();
        await stopped.Task.ConfigureAwait(false);
    }

    public void Dispose()
    {
        this.StopRecording();
    }
}

internal sealed class PushToTalkHook : IDisposable
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmKeyUp = 0x0101;
    private const int WmSysKeyDown = 0x0104;
    private const int WmSysKeyUp = 0x0105;
    private const int WmQuit = 0x0012;

    private readonly AudioDevices audio;
    private readonly object gate = new();
    private readonly HashSet<int> allowedProcesses = new();
    private readonly Thread thread;
    private HookProc? callback;
    private IntPtr hook;
    private uint threadId;
    private int virtualKey = 0x56;
    private bool keyHeld;

    public PushToTalkHook(AudioDevices audio)
    {
        this.audio = audio;
        this.thread = new Thread(this.Run)
        {
            IsBackground = true,
            Name = "XTY Push-to-talk hook"
        };
        this.thread.Start();
    }

    public void Configure(IEnumerable<int> processIds, int nextVirtualKey)
    {
        lock (this.gate)
        {
            this.allowedProcesses.Clear();
            foreach (int processId in processIds.Where(value => value > 0)) this.allowedProcesses.Add(processId);
            this.virtualKey = nextVirtualKey;
        }
    }

    private void Run()
    {
        this.threadId = GetCurrentThreadId();
        this.callback = this.OnKeyboard;
        using Process process = Process.GetCurrentProcess();
        using ProcessModule? module = process.MainModule;
        this.hook = SetWindowsHookEx(WhKeyboardLl, this.callback, GetModuleHandle(module?.ModuleName), 0);
        if (this.hook == IntPtr.Zero)
        {
            Protocol.Error($"无法注册全局语音按键，Win32={Marshal.GetLastWin32Error()}");
            return;
        }
        while (GetMessage(out Message message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
    }

    private IntPtr OnKeyboard(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int key = Marshal.ReadInt32(data);
            bool down = message == (IntPtr)WmKeyDown || message == (IntPtr)WmSysKeyDown;
            bool up = message == (IntPtr)WmKeyUp || message == (IntPtr)WmSysKeyUp;
            int configuredKey;
            lock (this.gate) configuredKey = this.virtualKey;
            if (key == configuredKey && down && !this.keyHeld)
            {
                int foregroundProcess = ForegroundProcessId();
                bool allowed;
                lock (this.gate) allowed = this.allowedProcesses.Contains(foregroundProcess);
                if (allowed)
                {
                    this.keyHeld = true;
                    try { this.audio.StartRecording(foregroundProcess); }
                    catch (Exception ex) { Protocol.Error($"无法开始录音：{ex.Message}"); }
                }
            }
            else if (key == configuredKey && up && this.keyHeld)
            {
                this.keyHeld = false;
                try { this.audio.StopRecording(); }
                catch (Exception ex) { Protocol.Error($"无法停止录音：{ex.Message}"); }
            }
        }
        return CallNextHookEx(this.hook, code, message, data);
    }

    private static int ForegroundProcessId()
    {
        IntPtr window = GetForegroundWindow();
        _ = GetWindowThreadProcessId(window, out uint processId);
        return unchecked((int)processId);
    }

    public void Dispose()
    {
        if (this.hook != IntPtr.Zero) UnhookWindowsHookEx(this.hook);
        if (this.threadId != 0) PostThreadMessage(this.threadId, WmQuit, IntPtr.Zero, IntPtr.Zero);
        if (this.thread.IsAlive) this.thread.Join(TimeSpan.FromSeconds(2));
        this.callback = null;
    }

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Handle;
        public uint Id;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public Point Point;
        public uint Private;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr instance, uint threadId);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")]
    private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage([In] ref Message message);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage([In] ref Message message);
    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint threadId, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
}

internal static class Program
{
    public static async Task Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(false);
        using var audio = new AudioDevices();
        using var hook = new PushToTalkHook(audio);
        Protocol.Send(new { type = "ready", version = "1.0" });

        string? line;
        while ((line = await Console.In.ReadLineAsync().ConfigureAwait(false)) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                using JsonDocument document = JsonDocument.Parse(line);
                JsonElement root = document.RootElement;
                string method = root.GetProperty("method").GetString() ?? "";
                JsonElement parameters = root.TryGetProperty("params", out JsonElement value) ? value : default;
                switch (method)
                {
                    case "configure":
                    {
                        int key = parameters.GetProperty("pushToTalkVirtualKey").GetInt32();
                        int[] processIds = parameters.GetProperty("processIds").EnumerateArray()
                            .Select(item => item.GetInt32()).ToArray();
                        hook.Configure(processIds, key);
                        break;
                    }
                    case "play":
                    {
                        byte[] wav = Convert.FromBase64String(parameters.GetProperty("audioBase64").GetString() ?? "");
                        _ = audio.PlayAsync(wav).ContinueWith(task =>
                        {
                            if (task.Exception is not null) Protocol.Error($"音频播放失败：{task.Exception.GetBaseException().Message}");
                        }, TaskScheduler.Default);
                        break;
                    }
                    case "shutdown":
                        return;
                }
            }
            catch (Exception ex)
            {
                Protocol.Error($"媒体命令处理失败：{ex.Message}");
            }
        }
    }
}
