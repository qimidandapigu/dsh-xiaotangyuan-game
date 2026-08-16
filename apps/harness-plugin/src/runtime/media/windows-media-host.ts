import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from '../../config.js'
import type { BinaryAsset } from '../providers/contracts.js'

export type MediaHostEvent = {
  type: 'ready'
  version: string
} | {
  type: 'recording.started'
  processId: number
} | {
  type: 'recording.completed'
  processId: number
  mediaType: string
  audioBase64: string
} | {
  type: 'error'
  message: string
}

export class WindowsMediaHost {
  private child?: ChildProcessWithoutNullStreams
  private readonly listeners = new Set<(event: MediaHostEvent) => void | Promise<void>>()

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['media'],
  ) {}

  private executablePath(): string {
    return this.config.executablePath
      ?? fileURLToPath(new URL('../../../media/windows-x64/XtyMediaHost.exe', import.meta.url))
  }

  async start(): Promise<boolean> {
    if (!this.config.enabled || process.platform !== 'win32') return false
    const executable = this.executablePath()
    try {
      await access(executable)
    } catch {
      this.ctx.logger.warn('xiaotangyuan-game: Windows 媒体服务不存在：%s', executable)
      return false
    }

    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.onLine(line))
    child.stderr.on('data', data => {
      const message = data.toString().trim()
      if (message !== '') this.ctx.logger.warn('xiaotangyuan-game media: %s', message)
    })
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      if (code !== 0 && code !== null) {
        this.ctx.logger.warn('xiaotangyuan-game: 媒体服务退出，code=%s signal=%s', code, signal)
      }
    })
    return true
  }

  onEvent(listener: (event: MediaHostEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private onLine(line: string): void {
    let event: MediaHostEvent
    try {
      event = JSON.parse(line) as MediaHostEvent
    } catch {
      this.ctx.logger.warn('xiaotangyuan-game: 媒体服务返回了无效 JSON')
      return
    }
    for (const listener of this.listeners) {
      Promise.resolve(listener(event)).catch(error => {
        this.ctx.logger.warn('xiaotangyuan-game: 媒体事件处理失败')
        this.ctx.logger.warn(error)
      })
    }
  }

  private send(method: string, params: unknown): void {
    if (this.child?.stdin.writable !== true) return
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  configure(processIds: readonly number[]): void {
    this.send('configure', {
      processIds: [...processIds],
      pushToTalkVirtualKey: this.config.pushToTalkVirtualKey,
    })
  }

  play(audio: BinaryAsset): void {
    if (audio.mediaType !== 'audio/wav') throw new Error(`Windows 媒体服务需要 audio/wav，收到 ${audio.mediaType}`)
    this.send('play', { audioBase64: Buffer.from(audio.bytes).toString('base64') })
  }

  async close(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child === undefined) return
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ method: 'shutdown', params: {} })}\n`)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
