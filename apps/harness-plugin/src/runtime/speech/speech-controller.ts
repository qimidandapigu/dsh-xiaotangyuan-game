import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from '../../config.js'
import { CapabilityRegistry } from '../capabilities.js'
import type { MediaHostEvent } from '../media/windows-media-host.js'
import { WindowsMediaHost } from '../media/windows-media-host.js'
import type { SpeechRecognitionProvider, SpeechSynthesisProvider } from '../providers/contracts.js'

export interface VoiceInteractionHandler {
  recordingStarted(processId: number): void
  transcriptReady(processId: number, transcript: string): void
  respond(processId: number, transcript: string, signal: AbortSignal): Promise<string>
  failed(processId: number, message: string): void
}

export class SpeechController {
  private readonly active = new Set<number>()
  private targets: readonly number[] = []
  private disposeListener?: () => void

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['speech'],
    private readonly media: WindowsMediaHost,
    private readonly handler: VoiceInteractionHandler,
    private readonly capabilities: CapabilityRegistry,
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled) return
    const [recognition, synthesis] = await Promise.all([
      this.selectRecognitionProvider(),
      this.selectSynthesisProvider(),
    ])
    if (recognition === undefined) this.ctx.logger.warn('xiaotangyuan-game: 当前没有已配置的语音识别能力')
    if (synthesis === undefined) this.ctx.logger.warn('xiaotangyuan-game: 当前没有已配置的语音合成能力')
    this.disposeListener = this.media.onEvent(event => this.onMediaEvent(event))
    if (await this.media.start()) this.media.configure(this.targets)
  }

  private async selectRecognitionProvider(): Promise<SpeechRecognitionProvider | undefined> {
    return await this.capabilities.resolve<SpeechRecognitionProvider>(
      'speech.transcribe',
      this.config.recognitionProvider,
    )
  }

  private async selectSynthesisProvider(): Promise<SpeechSynthesisProvider | undefined> {
    return await this.capabilities.resolve<SpeechSynthesisProvider>(
      'speech.synthesize',
      this.config.synthesisProvider,
    )
  }

  updateTargets(processIds: readonly number[]): void {
    this.targets = [...processIds]
    this.media.configure(processIds)
  }

  async speak(text: string, signal: AbortSignal): Promise<void> {
    const provider = await this.selectSynthesisProvider()
    if (provider === undefined) throw new Error('没有可用的语音合成 Provider，请先在 DSH 中绑定相应凭据')
    const audio = await provider.synthesize({ text }, signal)
    this.media.play(audio)
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
      const provider = await this.selectRecognitionProvider()
      if (provider === undefined) throw new Error('没有可用的语音识别能力，请先在 DSH 中绑定相应凭据')
      const transcript = await provider.transcribe({
        bytes: new Uint8Array(Buffer.from(event.audioBase64, 'base64')),
        mediaType: event.mediaType,
      }, controller.signal)
      this.handler.transcriptReady(event.processId, transcript)
      const reply = await this.handler.respond(event.processId, transcript, controller.signal)
      await this.speak(reply, controller.signal)
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
