import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AdapterHello, GameChatRequest } from '../../protocol/game.js'
import type { ResolvedConfig } from '../../config.js'
import {
  GAME_MEMORY_KINDS,
  resolveMemoryIdentity,
  type GameMemoryCandidate,
  type MemoryExtraction,
  type SharedProfilePatch,
} from './contracts.js'
import { MemoryStore } from './memory-store.js'

const EXTRACTION_SYSTEM_PROMPT = `You extract durable memory for a local game companion.
Return exactly one JSON object and no markdown.
Schema:
{"shared":{"preferredName"?:string,"language"?:string,"responseStyle"?:string,"interests"?:string[],"playStyles"?:string[],"companionName"?:string,"companionTraits"?:string[]}|null,"gameMemories":[{"kind":"goal"|"preference"|"relationship"|"decision"|"milestone"|"promise","subject":string,"summary":string,"importance":1|2|3|4|5}]}
Rules:
- shared is only for low-risk facts clearly about the real player across games: directly expressed interests, play styles, communication preferences, preferred name, language, or companion identity.
- Never infer sensitive traits, health, politics, religion, sexuality, finances, negative personality labels, or role-play as real-player profile.
- A fact true only in this game/save belongs in gameMemories, never shared.
- Do not store ordinary chatter, raw game state, transient conditions, secrets, paths, account IDs, or facts recoverable from the current screenshot/state.
- Prefer no memory over an uncertain memory. At most one shared change and two game memories.
- Each string must be concise; game summary <= 160 characters.`

function cleanString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned === '' ? undefined : cleaned.slice(0, maximum)
}

function stringList(value: unknown, maximumItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const output = value
    .map(item => cleanString(item, 80))
    .filter((item): item is string => item !== undefined)
    .slice(0, maximumItems)
  return output.length === 0 ? undefined : output
}

function parseShared(value: unknown): SharedProfilePatch | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const patch: SharedProfilePatch = {
    ...(cleanString(source.preferredName, 80) === undefined ? {} : { preferredName: cleanString(source.preferredName, 80) }),
    ...(cleanString(source.language, 40) === undefined ? {} : { language: cleanString(source.language, 40) }),
    ...(cleanString(source.responseStyle, 120) === undefined ? {} : { responseStyle: cleanString(source.responseStyle, 120) }),
    ...(stringList(source.interests, 3) === undefined ? {} : { interests: stringList(source.interests, 3) }),
    ...(stringList(source.playStyles, 3) === undefined ? {} : { playStyles: stringList(source.playStyles, 3) }),
    ...(cleanString(source.companionName, 80) === undefined ? {} : { companionName: cleanString(source.companionName, 80) }),
    ...(stringList(source.companionTraits, 3) === undefined ? {} : { companionTraits: stringList(source.companionTraits, 3) }),
  }
  return Object.keys(patch).length === 0 ? undefined : patch
}

function parseGameMemory(value: unknown): GameMemoryCandidate | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (typeof source.kind !== 'string' || !GAME_MEMORY_KINDS.includes(source.kind as GameMemoryCandidate['kind'])) return undefined
  const subject = cleanString(source.subject, 80)
  const summary = cleanString(source.summary, 160)
  const importance = typeof source.importance === 'number' ? Math.round(source.importance) : 0
  if (subject === undefined || summary === undefined || importance < 1 || importance > 5) return undefined
  return { kind: source.kind as GameMemoryCandidate['kind'], subject, summary, importance }
}

export function parseMemoryExtraction(text: string): MemoryExtraction {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (candidate.trim() === '') return { gameMemories: [] }
  try {
    const value = JSON.parse(candidate) as Record<string, unknown>
    const shared = parseShared(value.shared)
    const gameMemories = Array.isArray(value.gameMemories)
      ? value.gameMemories.map(parseGameMemory).filter((item): item is GameMemoryCandidate => item !== undefined).slice(0, 2)
      : []
    return { ...(shared === undefined ? {} : { shared }), gameMemories }
  } catch {
    return { gameMemories: [] }
  }
}

function extractionInput(adapter: AdapterHello, request: GameChatRequest, reply: string): string {
  return [
    `Game: ${adapter.gameId}`,
    `Player message: ${request.text.slice(0, 2_000)}`,
    `Companion final reply: ${reply.slice(0, 2_000)}`,
  ].join('\n')
}

export class MemoryService {
  readonly store: MemoryStore
  private learningQueue: Promise<void> = Promise.resolve()
  private closing = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['memory'],
  ) {
    this.store = new MemoryStore(config)
  }

  adapterConnected(adapter: AdapterHello): void {
    if (!this.config.enabled) return
    this.store.recordPlayedGame(adapter.gameId)
  }

  recall(adapter: AdapterHello | undefined, request: GameChatRequest): string | undefined {
    if (!this.config.enabled) return undefined
    const identity = resolveMemoryIdentity(adapter, request)
    return identity === undefined ? undefined : this.store.recall(identity, request.text)
  }

  scheduleLearn(
    adapter: AdapterHello | undefined,
    request: GameChatRequest,
    reply: string,
    interactionId: string,
    selection: ModelSelection,
  ): void {
    if (!this.config.enabled || !this.config.autoLearn || this.closing || adapter === undefined) return
    const identity = resolveMemoryIdentity(adapter, request)
    if (identity === undefined) return
    this.learningQueue = this.learningQueue
      .then(async () => {
        const extraction = await this.extract(adapter, request, reply, selection)
        if (extraction.shared !== undefined) this.store.updateSharedProfile(extraction.shared)
        this.store.remember(identity, extraction.gameMemories, interactionId)
      })
      .catch(error => {
        this.ctx.logger.warn('xiaotangyuan-game: 后台记忆提取失败，本轮回复不受影响')
        this.ctx.logger.warn(error)
      })
  }

  private async extract(
    adapter: AdapterHello,
    request: GameChatRequest,
    reply: string,
    selection: ModelSelection,
  ): Promise<MemoryExtraction> {
    const assembler = new BlockAssembler()
    const signal = AbortSignal.timeout(45_000)
    const messages = [createUserMessage({
      content: [{ type: 'text', text: extractionInput(adapter, request, reply) }],
      source: { kind: 'user' },
    })]
    for await (const chunk of this.ctx.llm.stream({
      provider: selection.provider,
      model: selection.model,
      messages,
      system: EXTRACTION_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 700,
      signal,
      purpose: 'compaction',
    })) assembler.push(chunk)
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    return parseMemoryExtraction(text)
  }

  async close(): Promise<void> {
    this.closing = true
    await this.learningQueue
    this.store.close()
  }
}
