import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { AdapterHello, GameChatContext, GameChatRequest } from '../../protocol/game.js'
import { MultimodalRouter } from '../multimodal/multimodal-router.js'

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

export function formatGamePrompt(
  adapter: AdapterHello | undefined,
  request: GameChatRequest,
  visualObservation: string | undefined,
  feedbackEnabled: boolean,
  mode: 'normal' | 'retry' | 'compose' = 'normal',
): string {
  const context = request.context ?? {}
  const facts = [
    `Game: ${adapter?.gameId ?? 'unknown'}`,
    context.playerName === undefined ? undefined : `Player: ${context.playerName}`,
    context.location === undefined ? undefined : `Location: ${context.location}`,
    context.date === undefined ? undefined : `Date: ${context.date}`,
    context.time === undefined ? undefined : `Time: ${context.time}`,
    context.nearbyNpc === undefined ? undefined : `Nearby NPC: ${context.nearbyNpc}`,
  ].filter((item): item is string => item !== undefined)
  const structuredObservation = context.observation === undefined
    ? undefined
    : JSON.stringify(context.observation).slice(0, 30_000)

  return [
    'You are an in-game AI companion.',
    'Reply in the same language as the player, naturally and briefly (at most three short sentences).',
    'Do not use Markdown. Never claim a game action succeeded unless a game tool returned an explicit successful result in this turn.',
    feedbackEnabled
      ? 'When the player clearly proposes a missing product capability or improvement, call game_feedback_submit exactly once before replying. For example, “如果能够加钓鱼功能就好了” is a feature request and must be submitted. Preserve the exact player sentence in playerQuote. An ordinary request to perform an already available in-game action is not feedback. Mention the returned feedback number only after the tool succeeds; if it fails, state that upload failed and never claim success.'
      : undefined,
    mode === 'retry'
      ? 'This is a regeneration of the player’s previous request. Produce a fresh replacement answer. Do not call game_feedback_submit, because feedback from the original request must never be uploaded twice.'
      : undefined,
    mode === 'compose'
      ? 'This is a one-off game-authored composition request. Do not call game_feedback_submit and do not refer to earlier conversation history.'
      : undefined,
    `Adapter: ${adapter?.adapterId ?? 'unknown'}`,
    context.roleInstructions === undefined
      ? undefined
      : `Game-specific role instructions:\n${context.roleInstructions}`,
    facts.join('\n'),
    structuredObservation === undefined ? undefined : `Structured game observation:\n${structuredObservation}`,
    visualObservation === undefined ? undefined : `Visual observation:\n${visualObservation}`,
    `Player message: ${request.text}`,
  ].filter((item): item is string => item !== undefined).join('\n\n')
}

export class GameAgentSession {
  private handle?: AgentHandle
  private lastRequest?: GameChatRequest

  constructor(
    private readonly ctx: Context,
    private readonly adapter: AdapterHello | undefined,
    private readonly multimodal: MultimodalRouter,
    private readonly feedbackEnabled = false,
  ) {}

  private async createAgent(): Promise<AgentHandle> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`game-${this.adapter?.gameId ?? 'unknown'}-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
    await handle.agent.whenIdle()
    return handle
  }

  private async ensureAgent(): Promise<AgentHandle> {
    if (this.handle === undefined) this.handle = await this.createAgent()
    return this.handle
  }

  private async run(
    handle: AgentHandle,
    request: GameChatRequest,
    mode: 'normal' | 'retry' | 'compose',
  ): Promise<{ reply: string, sessionId: string }> {
    const firstSeq = handle.agent.session.seq
    let visualObservation: string | undefined
    try {
      visualObservation = await this.multimodal.observeProcess(this.adapter?.processId, AbortSignal.timeout(30_000))
    } catch (error) {
      this.ctx.logger.warn('xiaotangyuan-game: 本次多模态观察失败，继续使用结构化状态')
      this.ctx.logger.warn(error)
    }
    handle.agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: formatGamePrompt(this.adapter, request, visualObservation, mode === 'normal' && this.feedbackEnabled, mode),
      }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    await this.ctx.sessions.flush(handle.agent.session)

    const reply = latestAssistantText(handle.agent.session.events, firstSeq)
    if (reply === '') throw new Error('model returned no text reply')
    return { reply, sessionId: String(handle.agent.session.id) }
  }

  async ask(request: GameChatRequest): Promise<{ reply: string, sessionId: string }> {
    this.lastRequest = request
    return await this.run(await this.ensureAgent(), request, 'normal')
  }

  async retry(context?: GameChatContext): Promise<{ reply: string, sessionId: string }> {
    if (this.lastRequest === undefined) throw new Error('当前游戏会话还没有可重试的玩家请求')
    const request: GameChatRequest = {
      text: this.lastRequest.text,
      ...((context ?? this.lastRequest.context) === undefined
        ? {}
        : { context: context ?? this.lastRequest.context }),
    }
    return await this.run(await this.ensureAgent(), request, 'retry')
  }

  async compose(request: GameChatRequest): Promise<{ reply: string, sessionId: string }> {
    const handle = await this.createAgent()
    try {
      return await this.run(handle, request, 'compose')
    } finally {
      await handle.dispose()
    }
  }

  async dispose(): Promise<void> {
    await this.handle?.dispose()
    this.handle = undefined
  }
}
