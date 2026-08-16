import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { AdapterHello, GameChatRequest } from '../../protocol/game.js'
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

function formatGamePrompt(
  adapter: AdapterHello | undefined,
  request: GameChatRequest,
  visualObservation: string | undefined,
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
    'Do not use Markdown and do not claim to have performed game actions.',
    facts.join('\n'),
    structuredObservation === undefined ? undefined : `Structured game observation:\n${structuredObservation}`,
    visualObservation === undefined ? undefined : `Visual observation:\n${visualObservation}`,
    `Player message: ${request.text}`,
  ].filter((item): item is string => item !== undefined).join('\n\n')
}

export class GameAgentSession {
  private handle?: AgentHandle

  constructor(
    private readonly ctx: Context,
    private readonly adapter: AdapterHello | undefined,
    private readonly multimodal: MultimodalRouter,
  ) {}

  private async ensureAgent(): Promise<AgentHandle> {
    if (this.handle !== undefined) return this.handle

    const selection = this.ctx.agentDefaultModel.currentSelection()
    this.handle = await this.ctx.agents.create({
      sessionId: SessionId(`game-${this.adapter?.gameId ?? 'unknown'}-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
    await this.handle.agent.whenIdle()
    return this.handle
  }

  async ask(request: GameChatRequest): Promise<{ reply: string, sessionId: string }> {
    const handle = await this.ensureAgent()
    const firstSeq = handle.agent.session.seq
    let visualObservation: string | undefined
    try {
      visualObservation = await this.multimodal.observeForeground(AbortSignal.timeout(30_000))
    } catch (error) {
      this.ctx.logger.warn('xiaotangyuan-game: 本次多模态观察失败，继续使用结构化状态')
      this.ctx.logger.warn(error)
    }
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: formatGamePrompt(this.adapter, request, visualObservation) }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    await this.ctx.sessions.flush(handle.agent.session)

    const reply = latestAssistantText(handle.agent.session.events, firstSeq)
    if (reply === '') throw new Error('model returned no text reply')
    return { reply, sessionId: String(handle.agent.session.id) }
  }

  async dispose(): Promise<void> {
    await this.handle?.dispose()
    this.handle = undefined
  }
}
