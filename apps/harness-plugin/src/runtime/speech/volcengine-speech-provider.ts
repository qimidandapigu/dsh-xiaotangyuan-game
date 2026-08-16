import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedConfig } from '../../config.js'
import type {
  BinaryAsset,
  SpeechRecognitionProvider,
  SpeechCapabilityProvider,
  SpeechSynthesisProvider,
  SpeechSynthesisRequest,
} from '../providers/contracts.js'
import { buildPcm16Wav } from './wav.js'

const ASR_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit'
const ASR_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'
const TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'

function compact(text: string): string {
  return text.length <= 300 ? text : `${text.slice(0, 300)}…`
}

async function responseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

export class VolcengineSpeechProvider implements SpeechCapabilityProvider, SpeechRecognitionProvider, SpeechSynthesisProvider {
  readonly id = 'volcengine'

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['speech'],
  ) {}

  async isAvailable(): Promise<boolean> {
    return (await this.ctx.credentials.describe(credentialRef(this.config.credentialRef))).configured
  }

  private async apiKey(): Promise<string> {
    const ref = credentialRef(this.config.credentialRef)
    const resolved = await this.ctx.credentials.resolve(ref)
    if (resolved === undefined) {
      throw new Error(`DSH 凭据 ${this.config.credentialRef} 尚未配置`)
    }
    return resolved.value.trim()
  }

  private headers(apiKey: string, resourceId: string, requestId: string): Headers {
    return new Headers({
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': requestId,
    })
  }

  async transcribe(audio: BinaryAsset, signal: AbortSignal): Promise<string> {
    if (audio.mediaType !== 'audio/wav') throw new Error(`语音识别需要 audio/wav，收到 ${audio.mediaType}`)
    const apiKey = await this.apiKey()
    const requestId = randomUUID()
    const headers = this.headers(apiKey, this.config.asrResourceId, requestId)
    headers.set('X-Api-Sequence', '-1')

    const submit = await fetch(ASR_SUBMIT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user: { uid: 'xiaotangyuan-game-ai' },
        audio: {
          data: Buffer.from(audio.bytes).toString('base64'),
          format: 'wav',
          codec: 'raw',
          rate: 16000,
          bits: 16,
          channel: 1,
        },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
        },
      }),
      signal,
    })
    if (!submit.ok) {
      throw new Error(`语音识别提交失败 HTTP ${submit.status}：${compact(await responseText(submit))}`)
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(500, undefined, { signal })
      const query = await fetch(ASR_QUERY_URL, {
        method: 'POST',
        headers: this.headers(apiKey, this.config.asrResourceId, requestId),
        body: '{}',
        signal,
      })
      const body = await responseText(query)
      const status = query.headers.get('X-Api-Status-Code') ?? ''
      if (status === '20000000') {
        const parsed = JSON.parse(body) as { result?: { text?: unknown } }
        const text = parsed.result?.text
        if (typeof text !== 'string' || text.trim() === '') throw new Error('语音识别成功但没有返回文本')
        return text.trim()
      }
      if (status === '20000001' || status === '') continue
      throw new Error(`语音识别查询失败 ${status}：${compact(body)}`)
    }
    throw new Error('语音识别等待结果超时')
  }

  async synthesize(request: SpeechSynthesisRequest, signal: AbortSignal): Promise<BinaryAsset> {
    const apiKey = await this.apiKey()
    const requestId = randomUUID()
    const response = await fetch(TTS_URL, {
      method: 'POST',
      headers: this.headers(apiKey, this.config.ttsResourceId, requestId),
      body: JSON.stringify({
        user: { uid: 'xiaotangyuan-game-ai' },
        req_params: {
          text: request.text,
          speaker: request.voice ?? this.config.ttsVoice,
          audio_params: { format: 'pcm', sample_rate: 24000 },
        },
      }),
      signal,
    })
    const body = await responseText(response)
    if (!response.ok) throw new Error(`语音合成失败 HTTP ${response.status}：${compact(body)}`)

    const chunks: Uint8Array[] = []
    for (const raw of body.replaceAll(/}\s*{/g, '}\n{').split(/\r?\n/)) {
      if (raw.trim() === '') continue
      let parsed: { data?: unknown }
      try {
        parsed = JSON.parse(raw) as { data?: unknown }
      } catch {
        continue
      }
      if (typeof parsed.data === 'string' && parsed.data !== '') {
        chunks.push(new Uint8Array(Buffer.from(parsed.data, 'base64')))
      }
    }
    const bytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    if (bytes === 0) throw new Error('语音合成没有返回音频数据')
    const pcm = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes: buildPcm16Wav(pcm, 24000, 1), mediaType: 'audio/wav' }
  }
}
