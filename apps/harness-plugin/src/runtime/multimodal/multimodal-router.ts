import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import screenshot from 'screenshot-desktop'
import type { ResolvedConfig } from '../../config.js'
import { WindowsMediaHost } from '../media/windows-media-host.js'
import type { BinaryAsset } from '../providers/contracts.js'

export interface MultimodalInput {
  selection: ModelSelection
  image: ImageAttachmentRef
}

function acceptsImages(info: LlmResolvedModelInfo): boolean {
  return info.inputModalities?.includes('image') ?? false
}

export class MultimodalRouter {
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['vision'],
    private readonly media: WindowsMediaHost,
  ) {}

  private async findImageModel(signal: AbortSignal): Promise<ModelSelection | undefined> {
    const preferred = this.ctx.agentDefaultModel.currentSelection()
    try {
      const info = await this.ctx.llm.resolveModelInfo(preferred.provider, preferred.model, signal)
      if (acceptsImages(info)) return preferred
    } catch {
      // Search the configured catalog for a model that can answer from the image directly.
    }
    for (const provider of this.ctx.llm.listProviders()) {
      let models
      try { models = await this.ctx.llm.listModels(provider.id) } catch { continue }
      for (const model of models) {
        if (!model.inputModalities?.includes('image')) continue
        try {
          const info = await this.ctx.llm.resolveModelInfo(provider.id, model.id, signal)
          if (acceptsImages(info)) return { provider: provider.id, model: model.id }
        } catch {
          // Keep looking; catalogs can contain unavailable routes.
        }
      }
    }
    return undefined
  }

  async prepareProcess(processId: number | undefined, signal: AbortSignal): Promise<MultimodalInput> {
    if (!this.config.enabled) throw new Error('当前游戏会话需要启用视觉输入')
    const selection = await this.findImageModel(signal)
    if (selection === undefined) throw new Error('没有可用的图片输入模型')
    const image: BinaryAsset = processId === undefined
      ? { bytes: new Uint8Array(await screenshot({ format: 'png' })), mediaType: 'image/png' }
      : await this.media.captureProcessWindow(processId, this.config.maxWidth, signal)
    if (image.mediaType !== 'image/png') throw new Error(`Windows 媒体服务返回了不支持的截图格式：${image.mediaType}`)
    return {
      selection,
      image: await this.ctx.attachments.saveImage({
        data: image.bytes,
        mediaType: 'image/png',
        name: 'game-window.png',
      }),
    }
  }
}
