import type { Context } from '@deepseek-ai/cordis'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import {
  readAdapterHello,
  readGameChat,
  readGameRetry,
  readStateUpdate,
  type AdapterHello,
  type GameChatContext,
} from '../protocol/game.js'
import { failure, parseRpcRequest, success, type RpcRequest } from '../protocol/json-rpc.js'
import { GameAgentSession } from '../runtime/agent/game-agent-session.js'
import { MultimodalRouter } from '../runtime/multimodal/multimodal-router.js'
import type { VoiceInteractionHandler } from '../runtime/speech/speech-controller.js'

interface ConnectionState {
  socket: WebSocket
  adapter?: AdapterHello
  session?: GameAgentSession
  latestObservation?: Record<string, unknown>
  queue: Promise<void>
}

export class GameGateway implements VoiceInteractionHandler {
  private readonly server: WebSocketServer
  private readonly connections = new Set<ConnectionState>()

  constructor(
    private readonly ctx: Context,
    host: string,
    port: number,
    private readonly multimodal: MultimodalRouter,
    private readonly processTargetsChanged: (processIds: readonly number[]) => void,
    private readonly feedbackEnabled: boolean,
    private readonly speak: (text: string, signal: AbortSignal) => Promise<void>,
  ) {
    this.server = new WebSocketServer({ host, port, maxPayload: 1024 * 1024 })
    this.server.on('connection', socket => this.onConnection(socket))
    this.server.on('listening', () => {
      console.info(`[dsh-xiaotangyuan-game] listening on ws://${host}:${port}`)
    })
    this.server.on('error', error => {
      console.error('[dsh-xiaotangyuan-game] WebSocket server error', error)
    })
  }

  private onConnection(socket: WebSocket): void {
    const state: ConnectionState = { socket, queue: Promise.resolve() }
    this.connections.add(state)
    this.send(socket, {
      jsonrpc: '2.0',
      method: 'gateway.ready',
      params: { protocolVersion: '1.0' },
    })

    socket.on('message', (data) => {
      state.queue = state.queue
        .then(() => this.onMessage(state, data))
        .catch(error => {
          console.error('[dsh-xiaotangyuan-game] request processing failed', error)
        })
    })
    socket.on('close', () => {
      this.connections.delete(state)
      this.publishProcessTargets()
      void state.session?.dispose().catch(error => {
        console.error('[dsh-xiaotangyuan-game] failed to dispose game agent', error)
      })
    })
  }

  private async onMessage(state: ConnectionState, data: RawData): Promise<void> {
    let request: RpcRequest
    try {
      request = parseRpcRequest(data.toString())
    } catch (error) {
      this.send(state.socket, failure(null, -32700, error instanceof Error ? error.message : String(error)))
      return
    }

    if (request.id === undefined) {
      try {
        await this.dispatch(state, request)
      } catch (error) {
        this.ctx.logger.warn('xiaotangyuan-game: 适配器通知处理失败')
        this.ctx.logger.warn(error)
      }
      return
    }
    try {
      const result = await this.dispatch(state, request)
      this.send(state.socket, success(request.id, result))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.send(state.socket, failure(request.id, -32000, message))
    }
  }

  private async dispatch(state: ConnectionState, request: RpcRequest): Promise<unknown> {
    switch (request.method) {
      case 'adapter.hello': {
        if (state.session !== undefined) throw new Error('adapter.hello may only be sent once per connection')
        state.adapter = readAdapterHello(request.params)
        state.session = new GameAgentSession(this.ctx, state.adapter, this.multimodal, this.feedbackEnabled)
        this.publishProcessTargets()
        return { accepted: true, protocolVersion: '1.0' }
      }
      case 'gateway.ping':
        return { pong: true }
      case 'chat.send': {
        if (state.session === undefined) throw new Error('adapter.hello must be sent before chat.send')
        const chat = readGameChat(request.params)
        if (chat.context?.observation !== undefined) state.latestObservation = chat.context.observation
        return await state.session.ask(chat)
      }
      case 'chat.retry': {
        if (state.session === undefined) throw new Error('adapter.hello must be sent before chat.retry')
        const retry = readGameRetry(request.params)
        if (retry.context?.observation !== undefined) state.latestObservation = retry.context.observation
        const result = await state.session.retry(retry.context)
        this.notify(state, 'assistant.present', { text: result.reply, source: 'retry' })
        void this.speak(result.reply, AbortSignal.timeout(120_000)).catch(error => {
          const message = error instanceof Error ? error.message : String(error)
          this.notify(state, 'assistant.error', { message: `重试回复已生成，但语音播放失败：${message}` })
        })
        return result
      }
      case 'assistant.compose': {
        if (state.session === undefined) throw new Error('adapter.hello must be sent before assistant.compose')
        const chat = readGameChat(request.params)
        if (chat.context?.observation !== undefined) state.latestObservation = chat.context.observation
        return await state.session.compose(chat)
      }
      case 'state.update':
        state.latestObservation = readStateUpdate(request.params)
        return { accepted: true }
      default:
        throw new Error(`unknown method: ${request.method}`)
    }
  }

  private publishProcessTargets(): void {
    this.processTargetsChanged([...this.connections]
      .map(connection => connection.adapter?.processId)
      .filter((value): value is number => value !== undefined))
  }

  private connectionForProcess(processId: number): ConnectionState | undefined {
    return [...this.connections].find(connection => connection.adapter?.processId === processId)
  }

  private notify(connection: ConnectionState, method: string, params: unknown): void {
    this.send(connection.socket, { jsonrpc: '2.0', method, params })
  }

  recordingStarted(processId: number): void {
    const connection = this.connectionForProcess(processId)
    if (connection !== undefined) this.notify(connection, 'assistant.status', { status: 'recording' })
  }

  transcriptReady(processId: number, transcript: string): void {
    const connection = this.connectionForProcess(processId)
    if (connection !== undefined) this.notify(connection, 'assistant.status', { status: 'thinking', transcript })
  }

  async respond(processId: number, transcript: string, _signal: AbortSignal): Promise<string> {
    const connection = this.connectionForProcess(processId)
    if (connection?.session === undefined) throw new Error('前台游戏没有连接到小汤圆 Gateway')
    const context: GameChatContext = {
      ...(connection.latestObservation === undefined ? {} : { observation: connection.latestObservation }),
    }
    const result = await connection.session.ask({ text: transcript, context })
    this.notify(connection, 'assistant.present', { text: result.reply, source: 'voice' })
    return result.reply
  }

  failed(processId: number, message: string): void {
    const connection = this.connectionForProcess(processId)
    if (connection !== undefined) this.notify(connection, 'assistant.error', { message })
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }

  async close(): Promise<void> {
    const sessions: GameAgentSession[] = []
    for (const connection of this.connections) {
      connection.socket.close(1001, 'gateway shutting down')
      if (connection.session !== undefined) sessions.push(connection.session)
    }
    this.connections.clear()
    await Promise.allSettled(sessions.map(session => session.dispose()))
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}
