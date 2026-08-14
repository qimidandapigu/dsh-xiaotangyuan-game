import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import { registerGameTools } from './game-tools.js'
import { failure, parseRpcRequest, success, type RpcId, type RpcRequest } from './protocol.js'

export const name = 'dsh-game-agent'
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'tools']

export interface Config {
  host?: string
  port?: number
}

interface AdapterHello {
  adapterId: string
  gameId: string
  version: string
  protocolVersion: string
}

interface ChatContext {
  playerName?: string
  location?: string
  date?: string
  time?: string
  nearbyNpc?: string
}

interface ChatSend {
  text: string
  context?: ChatContext
}

interface ConnectionState {
  socket: WebSocket
  adapter?: AdapterHello
  handle?: AgentHandle
  queue: Promise<void>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('params must be an object')
  }
  return value as Record<string, unknown>
}

function readHello(value: unknown): AdapterHello {
  const params = asRecord(value)
  const required = ['adapterId', 'gameId', 'version', 'protocolVersion'] as const
  for (const key of required) {
    if (typeof params[key] !== 'string' || params[key].trim() === '') {
      throw new Error(`${key} must be a non-empty string`)
    }
  }
  return params as unknown as AdapterHello
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readChat(value: unknown): ChatSend {
  const params = asRecord(value)
  if (typeof params.text !== 'string' || params.text.trim() === '') {
    throw new Error('text must be a non-empty string')
  }

  let context: ChatContext | undefined
  if (params.context !== undefined) {
    const source = asRecord(params.context)
    context = {
      playerName: optionalString(source, 'playerName'),
      location: optionalString(source, 'location'),
      date: optionalString(source, 'date'),
      time: optionalString(source, 'time'),
      nearbyNpc: optionalString(source, 'nearbyNpc'),
    }
  }

  return { text: params.text.trim(), ...(context === undefined ? {} : { context }) }
}

function latestAssistantText(events: readonly SessionEvent[], firstSeq: number): string {
  let text = ''
  for (const event of events) {
    if (event.seq < firstSeq || event.type !== 'assistant/message') continue
    const candidate = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (candidate !== '') text = candidate
  }
  return text
}

function formatGamePrompt(adapter: AdapterHello | undefined, request: ChatSend): string {
  const context = request.context ?? {}
  const facts = [
    `Game: ${adapter?.gameId ?? 'unknown'}`,
    context.playerName === undefined ? undefined : `Player: ${context.playerName}`,
    context.location === undefined ? undefined : `Location: ${context.location}`,
    context.date === undefined ? undefined : `Date: ${context.date}`,
    context.time === undefined ? undefined : `Time: ${context.time}`,
    context.nearbyNpc === undefined ? undefined : `Nearby NPC: ${context.nearbyNpc}`,
  ].filter((item): item is string => item !== undefined)

  return [
    'You are an in-game conversational companion inside Stardew Valley.',
    'Reply in the same language as the player, naturally and briefly (at most three short sentences).',
    'Do not use Markdown and do not claim to have performed game actions.',
    facts.join('\n'),
    `Player message: ${request.text}`,
  ].join('\n\n')
}

class GameGateway {
  private readonly server: WebSocketServer
  private readonly connections = new Set<ConnectionState>()

  constructor(
    private readonly ctx: Context,
    host: string,
    port: number,
  ) {
    this.server = new WebSocketServer({ host, port, maxPayload: 1024 * 1024 })
    this.server.on('connection', socket => this.onConnection(socket))
    this.server.on('listening', () => {
      console.info(`[dsh-game-agent] listening on ws://${host}:${port}`)
    })
    this.server.on('error', error => {
      console.error('[dsh-game-agent] WebSocket server error', error)
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
          console.error('[dsh-game-agent] request processing failed', error)
        })
    })
    socket.on('close', () => {
      this.connections.delete(state)
      void state.handle?.dispose().catch(error => {
        console.error('[dsh-game-agent] failed to dispose game agent', error)
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

    if (request.id === undefined) return
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
        state.adapter = readHello(request.params)
        return { accepted: true, protocolVersion: '1.0' }
      }
      case 'gateway.ping':
        return { pong: true }
      case 'chat.send':
        return await this.chat(state, readChat(request.params))
      default:
        throw new Error(`unknown method: ${request.method}`)
    }
  }

  private async ensureAgent(state: ConnectionState): Promise<AgentHandle> {
    if (state.handle !== undefined) return state.handle

    const selection = this.ctx.agentDefaultModel.currentSelection()
    state.handle = await this.ctx.agents.create({
      sessionId: SessionId(`game-${state.adapter?.gameId ?? 'unknown'}-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
    await state.handle.agent.whenIdle()
    return state.handle
  }

  private async chat(state: ConnectionState, request: ChatSend): Promise<unknown> {
    const handle = await this.ensureAgent(state)
    const firstSeq = handle.agent.session.seq
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: formatGamePrompt(state.adapter, request) }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    await this.ctx.sessions.flush(handle.agent.session)

    const reply = latestAssistantText(handle.agent.session.events, firstSeq)
    if (reply === '') throw new Error('model returned no text reply')
    return { reply, sessionId: String(handle.agent.session.id) }
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }

  async close(): Promise<void> {
    const handles: AgentHandle[] = []
    for (const connection of this.connections) {
      connection.socket.close(1001, 'gateway shutting down')
      if (connection.handle !== undefined) handles.push(connection.handle)
    }
    this.connections.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose()))
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const host = config.host ?? '127.0.0.1'
  const port = config.port ?? 32145
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('dsh-game-agent only permits loopback hosts')
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('port must be an integer between 1024 and 65535')
  }

  registerGameTools(ctx)

  ctx.effect(() => {
    const gateway = new GameGateway(ctx, host, port)
    return () => gateway.close()
  })
}

export type { RpcFailure, RpcRequest, RpcSuccess } from './protocol.js'
