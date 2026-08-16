import { describe, expect, it } from 'vitest'
import { missingRequiredCapabilities, REQUIRED_ENGINE_CAPABILITIES } from '../src/runtime/capabilities.js'

describe('required engine capabilities', () => {
  it('requires voice and multimodal capabilities independently of vendors', () => {
    expect(REQUIRED_ENGINE_CAPABILITIES).toEqual([
      'multimodal-understanding',
      'speech-recognition',
      'speech-synthesis',
      'microphone-capture',
      'audio-playback',
    ])
  })

  it('reports capabilities that have no ready provider', () => {
    expect(missingRequiredCapabilities([
      { capability: 'multimodal-understanding', ready: true, provider: 'any-vision-provider' },
      { capability: 'microphone-capture', ready: true, provider: 'windows-media-host' },
    ])).toEqual([
      'speech-recognition',
      'speech-synthesis',
      'audio-playback',
    ])
  })
})
