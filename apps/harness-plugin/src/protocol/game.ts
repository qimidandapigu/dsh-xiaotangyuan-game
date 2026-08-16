export interface AdapterHello {
  adapterId: string
  gameId: string
  version: string
  protocolVersion: string
  processId?: number
}

export interface GameChatContext {
  playerName?: string
  location?: string
  date?: string
  time?: string
  nearbyNpc?: string
  observation?: Record<string, unknown>
}

export interface GameChatRequest {
  text: string
  context?: GameChatContext
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('params must be an object')
  }
  return value as Record<string, unknown>
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function readAdapterHello(value: unknown): AdapterHello {
  const params = asRecord(value)
  const required = ['adapterId', 'gameId', 'version', 'protocolVersion'] as const
  for (const key of required) {
    if (typeof params[key] !== 'string' || params[key].trim() === '') {
      throw new Error(`${key} must be a non-empty string`)
    }
  }
  const processId = params.processId
  if (processId !== undefined && (!Number.isSafeInteger(processId) || (processId as number) <= 0)) {
    throw new Error('processId must be a positive integer when provided')
  }
  return params as unknown as AdapterHello
}

export function readGameChat(value: unknown): GameChatRequest {
  const params = asRecord(value)
  if (typeof params.text !== 'string' || params.text.trim() === '') {
    throw new Error('text must be a non-empty string')
  }

  let context: GameChatContext | undefined
  if (params.context !== undefined) {
    const source = asRecord(params.context)
    context = {
      playerName: optionalString(source, 'playerName'),
      location: optionalString(source, 'location'),
      date: optionalString(source, 'date'),
      time: optionalString(source, 'time'),
      nearbyNpc: optionalString(source, 'nearbyNpc'),
      ...(source.observation === undefined ? {} : { observation: asRecord(source.observation) }),
    }
  }

  return { text: params.text.trim(), ...(context === undefined ? {} : { context }) }
}

export function readStateUpdate(value: unknown): Record<string, unknown> {
  const params = asRecord(value)
  return asRecord(params.observation)
}
