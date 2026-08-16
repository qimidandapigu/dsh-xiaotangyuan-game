import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type FinishReason, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import screenshot from 'screenshot-desktop'
import type { ResolvedConfig } from '../../config.js'

interface ModelRoute {
  provider: string
  model: string
}

function acceptsImages(info: LlmResolvedModelInfo): boolean {
  return info.inputModalities?.includes('image') ?? false
}

function describeFinish(reason: FinishReason): string | undefined {
  if (reason.kind === 'error' || reason.kind === 'aborted') return reason.failure.message
  if (reason.kind === 'max-tokens') return '视觉模型达到输出上限'
  return undefined
}

export class MultimodalRouter {
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['vision'],
  ) {}

  private async findImageModel(signal: AbortSignal): Promise<ModelRoute | undefined> {
    const preferred = this.ctx.agentDefaultModel.currentSelection()
    try {
      const info = await this.ctx.llm.resolveModelInfo(preferred.provider, preferred.model, signal)
      if (acceptsImages(info)) return { provider: preferred.provider, model: preferred.model }
    } catch {
      // The default route may be unavailable while another configured route supports images.
    }

    for (const provider of this.ctx.llm.listProviders()) {
      let models
      try {
        models = await this.ctx.llm.listModels(provider.id)
      } catch {
        continue
      }
      for (const model of models) {
        if (!model.inputModalities?.includes('image')) continue
        try {
          const info = await this.ctx.llm.resolveModelInfo(provider.id, model.id, signal)
          if (acceptsImages(info)) return { provider: provider.id, model: model.id }
        } catch {
          // Keep looking; model catalogs are advisory.
        }
      }
    }
    return undefined
  }

  async observeForeground(signal: AbortSignal): Promise<string | undefined> {
    if (!this.config.enabled) return undefined
    const route = await this.findImageModel(signal)
    if (route === undefined) return undefined

    const png = await screenshot({ format: 'png' })
    const attachment = await this.ctx.attachments.saveImage({
      data: new Uint8Array(png),
      mediaType: 'image/png',
      name: 'game-window.png',
    })

    let text = ''
    for await (const chunk of this.ctx.llm.stream({
      ...route,
      messages: [createUserMessage({
        source: { kind: 'user' },
        content: [
          { type: 'text', text: this.config.prompt },
          { type: 'image', attachment },
        ],
      })],
      maxTokens: 500,
      temperature: 0.1,
      signal,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      if (chunk.type === 'finish') {
        const failure = describeFinish(chunk.reason)
        if (failure !== undefined) throw new Error(`多模态观察失败：${failure}`)
      }
    }

    const result = text.trim()
    return result === '' ? undefined : result
  }
}
