import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../src/config.js'
import { resolveMemoryIdentity } from '../src/runtime/memory/contracts.js'
import { parseMemoryExtraction } from '../src/runtime/memory/memory-service.js'
import { MemoryStore } from '../src/runtime/memory/memory-store.js'

const temporaryDirectories: string[] = []

function store(): MemoryStore {
  const directory = mkdtempSync(join(tmpdir(), 'xiaotangyuan-memory-test-'))
  temporaryDirectories.push(directory)
  const config: ResolvedConfig['memory'] = {
    enabled: true,
    autoLearn: true,
    directory,
    profileId: 'test-player',
    maxGameEntries: 50,
  }
  return new MemoryStore(config)
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('XiaoTangYuan isolated memory', () => {
  it('shares the player profile but isolates game memory by game and save', () => {
    const memory = store()
    const farmA = { gameId: 'stardew-valley', saveId: 'farm-a' }
    const farmB = { gameId: 'stardew-valley', saveId: 'farm-b' }
    memory.updateSharedProfile({ interests: ['钓鱼'], playStyles: ['慢慢探索'] })
    memory.remember(farmA, [{ kind: 'goal', subject: 'community-center', summary: '想先修复社区中心', importance: 4 }], 'turn-1')

    expect(memory.recall(farmA, '今天做什么')).toContain('想先修复社区中心')
    expect(memory.recall(farmB, '今天做什么')).not.toContain('想先修复社区中心')
    expect(memory.recall({ gameId: 'oxygen-not-included', saveId: 'colony-a' }, '你好')).toContain('钓鱼')
    memory.close()
  })

  it('updates a repeated subject instead of accumulating raw history', () => {
    const memory = store()
    const identity = { gameId: 'dont-starve-together', saveId: 'world-a' }
    memory.remember(identity, [{ kind: 'goal', subject: 'base', summary: '准备在草原建家', importance: 3 }], 'turn-1')
    memory.remember(identity, [{ kind: 'goal', subject: 'base', summary: '决定把基地建在猪王附近', importance: 4 }], 'turn-2')

    expect(memory.listGameMemory(identity)).toHaveLength(1)
    expect(memory.listGameMemory(identity)[0]?.summary).toBe('决定把基地建在猪王附近')
    memory.close()
  })

  it('validates automatic extraction and ignores malformed output', () => {
    expect(parseMemoryExtraction('{"shared":{"interests":["种田"]},"gameMemories":[{"kind":"goal","subject":"矿洞","summary":"想下到 40 层","importance":4}]}')).toEqual({
      shared: { interests: ['种田'] },
      gameMemories: [{ kind: 'goal', subject: '矿洞', summary: '想下到 40 层', importance: 4 }],
    })
    expect(parseMemoryExtraction('not json')).toEqual({ gameMemories: [] })
  })

  it('prefers the current request save identity', () => {
    expect(resolveMemoryIdentity(
      { adapterId: 'test', gameId: 'test-game', version: '1', protocolVersion: '1.1', saveId: 'old-save' },
      { text: 'hi', context: { saveId: 'current-save' } },
    )).toEqual({ gameId: 'test-game', saveId: 'current-save' })
  })
})
