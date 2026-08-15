using System;
using System.IO;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StardewAgentMod;

internal sealed class GameAgentClient : IAsyncDisposable
{
    private readonly Uri gatewayUri;
    private readonly SemaphoreSlim requestLock = new(1, 1);
    private ClientWebSocket? socket;
    private long nextRequestId;

    public GameAgentClient(string gatewayUrl)
    {
        this.gatewayUri = new Uri(gatewayUrl, UriKind.Absolute);
        if (this.gatewayUri.Scheme is not "ws" and not "wss")
            throw new ArgumentException("GatewayUrl must use ws:// or wss://.", nameof(gatewayUrl));
    }

    public async Task<string> SendChatAsync(string text, object context, CancellationToken cancellationToken)
    {
        await this.requestLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await this.EnsureConnectedAsync(cancellationToken).ConfigureAwait(false);
            using JsonDocument response = await this.SendRequestAsync(
                "chat.send",
                new { text, context },
                cancellationToken
            ).ConfigureAwait(false);

            JsonElement root = response.RootElement;
            if (root.TryGetProperty("error", out JsonElement error))
            {
                string message = error.TryGetProperty("message", out JsonElement errorMessage)
                    ? errorMessage.GetString() ?? "Unknown gateway error."
                    : "Unknown gateway error.";
                throw new InvalidOperationException(message);
            }

            if (!root.TryGetProperty("result", out JsonElement result)
                || !result.TryGetProperty("reply", out JsonElement reply))
            {
                throw new InvalidOperationException("Gateway returned no reply.");
            }

            return reply.GetString() ?? string.Empty;
        }
        finally
        {
            this.requestLock.Release();
        }
    }

    private async Task EnsureConnectedAsync(CancellationToken cancellationToken)
    {
        if (this.socket?.State == WebSocketState.Open)
            return;

        if (this.socket is not null)
        {
            this.socket.Dispose();
            this.socket = null;
        }

        this.socket = new ClientWebSocket();
        await this.socket.ConnectAsync(this.gatewayUri, cancellationToken).ConfigureAwait(false);
        using JsonDocument hello = await this.SendRequestAsync(
            "adapter.hello",
            new
            {
                adapterId = "qimidandapigu.StardewAgent",
                gameId = "stardew-valley",
                version = "0.2.0",
                protocolVersion = "1.0"
            },
            cancellationToken
        ).ConfigureAwait(false);

        if (hello.RootElement.TryGetProperty("error", out JsonElement error))
        {
            string message = error.TryGetProperty("message", out JsonElement errorMessage)
                ? errorMessage.GetString() ?? "Adapter handshake failed."
                : "Adapter handshake failed.";
            throw new InvalidOperationException(message);
        }
    }

    private async Task<JsonDocument> SendRequestAsync(string method, object parameters, CancellationToken cancellationToken)
    {
        ClientWebSocket activeSocket = this.socket
            ?? throw new InvalidOperationException("Gateway is not connected.");
        long id = Interlocked.Increment(ref this.nextRequestId);
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            jsonrpc = "2.0",
            id,
            method,
            @params = parameters
        });

        await activeSocket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken).ConfigureAwait(false);

        while (true)
        {
            using MemoryStream message = new();
            byte[] buffer = new byte[8192];
            WebSocketReceiveResult result;
            do
            {
                result = await activeSocket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                    throw new WebSocketException("Gateway closed the connection.");
                message.Write(buffer, 0, result.Count);
                if (message.Length > 1024 * 1024)
                    throw new InvalidOperationException("Gateway response exceeded 1 MiB.");
            }
            while (!result.EndOfMessage);

            JsonDocument document = JsonDocument.Parse(message.ToArray());
            JsonElement root = document.RootElement;
            if (root.TryGetProperty("id", out JsonElement responseId)
                && responseId.ValueKind == JsonValueKind.Number
                && responseId.TryGetInt64(out long value)
                && value == id)
            {
                return document;
            }

            document.Dispose();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (this.socket is not null)
        {
            try
            {
                if (this.socket.State == WebSocketState.Open)
                {
                    using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(2));
                    await this.socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "mod unloading", timeout.Token)
                        .ConfigureAwait(false);
                }
            }
            catch
            {
                // The game is shutting down; aborting an already broken socket is safe.
            }
            this.socket.Dispose();
            this.socket = null;
        }

        this.requestLock.Dispose();
    }
}
