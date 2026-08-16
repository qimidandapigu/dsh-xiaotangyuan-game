import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import { resolveConfig, type Config } from './config.js'
import { GameGateway } from './gateway/game-gateway.js'
import { WindowsMediaHost } from './runtime/media/windows-media-host.js'
import { MultimodalRouter } from './runtime/multimodal/multimodal-router.js'
import { SignedFeedbackClient } from './runtime/feedback/signed-feedback-client.js'
import { SpeechController } from './runtime/speech/speech-controller.js'
import { VolcengineSpeechProvider } from './runtime/speech/volcengine-speech-provider.js'
import { registerGameTools } from './tools/game-mod-tools.js'

export const name = 'dsh-xiaotangyuan-game'
export const inject = ['agentDefaultModel', 'agents', 'attachments', 'credentials', 'llm', 'sessions', 'tools']

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const feedback = resolved.feedback.enabled ? new SignedFeedbackClient(ctx, resolved.feedback) : undefined
  registerGameTools(ctx, feedback, resolved.installers.dontStarve)

  ctx.effect(() => {
    const media = new WindowsMediaHost(ctx, resolved.media)
    const multimodal = new MultimodalRouter(ctx, resolved.vision, media)
    let speech: SpeechController | undefined
    const gateway = new GameGateway(
      ctx,
      resolved.host,
      resolved.port,
      multimodal,
      processIds => speech?.updateTargets(processIds),
      feedback !== undefined,
      async (text, signal) => {
        if (speech === undefined) throw new Error('语音运行时尚未启动')
        await speech.speak(text, signal)
      },
    )
    const speechProviders = [new VolcengineSpeechProvider(ctx, resolved.speech)]
    speech = new SpeechController(ctx, resolved.speech, media, gateway, speechProviders)
    void speech.start().catch(error => {
      ctx.logger.warn('xiaotangyuan-game: 语音运行时启动失败')
      ctx.logger.warn(error)
    })
    return async () => {
      await speech?.close()
      await gateway.close()
    }
  })
}

export type { Config } from './config.js'
export type { FeedbackReceipt, FeedbackReport, FeedbackSubmission } from './runtime/feedback/contracts.js'
export type { AdapterHello, GameChatContext, GameChatRequest } from './protocol/game.js'
export type { RpcFailure, RpcRequest, RpcSuccess } from './protocol/json-rpc.js'
export { REQUIRED_ENGINE_CAPABILITIES, missingRequiredCapabilities } from './runtime/capabilities.js'
export type {
  BinaryAsset,
  HostMediaService,
  MultimodalProvider,
  MultimodalRequest,
  SpeechRecognitionProvider,
  SpeechCapabilityProvider,
  SpeechSynthesisProvider,
  SpeechSynthesisRequest,
} from './runtime/providers/contracts.js'
