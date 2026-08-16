import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { readAdapterHello, readStateUpdate } from '../src/protocol/game.js'
import { buildPcm16Wav } from '../src/runtime/speech/wav.js'

describe('game runtime configuration', () => {
  it('defaults to mandatory multimodal and speech capabilities without embedding secrets', () => {
    const config = resolveConfig()
    expect(config.vision.enabled).toBe(true)
    expect(config.speech.enabled).toBe(true)
    expect(config.speech.provider).toBe('auto')
    expect(config.speech.credentialRef).toBe('VOLCENGINE_API_KEY')
    expect(config.media.pushToTalkVirtualKey).toBe(0x56)
    expect(JSON.stringify(config)).not.toContain('apiKey')
  })
})

describe('game protocol extensions', () => {
  it('accepts a process identity for foreground push-to-talk targeting', () => {
    expect(readAdapterHello({
      adapterId: 'test.adapter',
      gameId: 'test-game',
      version: '1.0.0',
      protocolVersion: '1.0',
      processId: 1234,
    }).processId).toBe(1234)
  })

  it('accepts structured state updates', () => {
    expect(readStateUpdate({ observation: { player: { health: 80 } } })).toEqual({
      player: { health: 80 },
    })
  })
})

describe('host audio format', () => {
  it('wraps PCM16 bytes in a valid mono WAV container', () => {
    const wav = buildPcm16Wav(new Uint8Array([0, 0, 1, 0]), 16_000, 1)
    expect(Buffer.from(wav.subarray(0, 4)).toString('ascii')).toBe('RIFF')
    expect(Buffer.from(wav.subarray(8, 12)).toString('ascii')).toBe('WAVE')
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(4)
  })
})
