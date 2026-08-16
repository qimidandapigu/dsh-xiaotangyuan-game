import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from '../../config.js'
import type { MediaHostEvent } from '../media/windows-media-host.js'
import { WindowsMediaHost } from '../media/windows-media-host.js'
import type { SpeechCapabilityProvider } from '../providers/contracts.js'

export interface VoiceInteractionHandler {
  recordingStarted(processId: number): void
  transcriptReady(processId: number, transcript: string): void
  respond(processId: number, transcript: string, signal: AbortSignal): Promise<string>
  failed(processId: number, message: string): void
}

export class SpeechController {
  private readonly active = new Set<number>()
  private disposeListener?: () => void

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['speech'],
    private readonly media: WindowsMediaHost,
    private readonly handler: VoiceInteractionHandler,
    private readonly providers: readonly SpeechCapabilityProvider[],
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled) return
    if (await this.selectProvider() === undefined) {
      this.ctx.logger.warn('xiaotangyuan-game: 当前没有已配置的语音 Provider')
    }
    this.disposeListener = this.media.onEvent(event => this.onMediaEvent(event))
    await this.media.start()
  }

  private async selectProvider(): Promise<SpeechCapabilityProvider | undefined> {
    const candidates = this.config.provider === 'auto'
      ? this.providers
      : this.providers.filter(provider => provider.id === this.config.provider)
    for (const provider of candidates) {
      if (await provider.isAvailable()) return provider
    }
    return undefined
  }

  updateTargets(processIds: readonly number[]): void {
    this.media.configure(processIds)
  }

  private async onMediaEvent(event: MediaHostEvent): Promise<void> {
    if (event.type === 'error') {
      this.ctx.logger.warn('xiaotangyuan-game media: %s', event.message)
      return
    }
    if (event.type === 'recording.started') {
      this.handler.recordingStarted(event.processId)
      return
    }
    if (event.type !== 'recording.completed' || this.active.has(event.processId)) return

    this.active.add(event.processId)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('语音交互超时')), 120_000)
    try {
      const provider = await this.selectProvider()
      if (provider === undefined) throw new Error('没有可用的语音识别与合成 Provider，请先在 DSH 中绑定相应凭据')
      const transcript = await provider.transcribe({
        bytes: new Uint8Array(Buffer.from(event.audioBase64, 'base64')),
        mediaType: event.mediaType,
      }, controller.signal)
      this.handler.transcriptReady(event.processId, transcript)
      const reply = await this.handler.respond(event.processId, transcript, controller.signal)
      const audio = await provider.synthesize({ text: reply }, controller.signal)
      this.media.play(audio)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.handler.failed(event.processId, message)
    } finally {
      clearTimeout(timeout)
      this.active.delete(event.processId)
    }
  }

  async close(): Promise<void> {
    this.disposeListener?.()
    this.disposeListener = undefined
    await this.media.close()
  }
}
