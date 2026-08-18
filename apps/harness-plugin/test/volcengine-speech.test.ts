import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { VolcengineSpeechProvider } from '../src/runtime/speech/volcengine-speech-provider.js'

function context(): Context {
  return {
    credentials: {
      describe: async () => ({ configured: true }),
      resolve: async () => ({ value: 'test-key' }),
    },
    logger: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Context
}

afterEach(() => vi.unstubAllGlobals())

describe('Volcengine speech low-latency paths', () => {
  it('yields HTTP chunked TTS audio before the complete response is buffered', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"data":"AQI='))
        controller.enqueue(encoder.encode('"}\n{"data":"AwQ="}\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    const provider = new VolcengineSpeechProvider(context(), resolveConfig().speech)
    const chunks: number[][] = []
    for await (const chunk of provider.synthesizeStream({ text: '你好。' }, new AbortController().signal)) {
      chunks.push([...chunk])
    }
    expect(chunks).toEqual([[1, 2], [3, 4]])
  })

  it('uses the one-request flash recognizer instead of polling when available', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { text: '你好小汤圆' } }), {
      status: 200,
      headers: { 'X-Api-Status-Code': '20000000' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcengineSpeechProvider(context(), resolveConfig().speech)
    const text = await provider.transcribe({ bytes: new Uint8Array(48), mediaType: 'audio/wav' }, new AbortController().signal)
    expect(text).toBe('你好小汤圆')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/recognize/flash')
  })
})
