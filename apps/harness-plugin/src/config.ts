export interface VisionConfig {
  enabled?: boolean
  prompt?: string
}

export interface SpeechConfig {
  enabled?: boolean
  provider?: string
  credentialRef?: string
  asrResourceId?: string
  ttsResourceId?: string
  ttsVoice?: string
}

export interface MediaConfig {
  enabled?: boolean
  pushToTalkVirtualKey?: number
  executablePath?: string
}

export interface Config {
  host?: string
  port?: number
  vision?: VisionConfig
  speech?: SpeechConfig
  media?: MediaConfig
}

export interface ResolvedConfig {
  host: string
  port: number
  vision: {
    enabled: boolean
    prompt: string
  }
  speech: {
    enabled: boolean
    provider: string
    credentialRef: string
    asrResourceId: string
    ttsResourceId: string
    ttsVoice: string
  }
  media: {
    enabled: boolean
    pushToTalkVirtualKey: number
    executablePath?: string
  }
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const host = config.host ?? '127.0.0.1'
  const port = config.port ?? 32145

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('dsh-xiaotangyuan-game only permits loopback hosts')
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('port must be an integer between 1024 and 65535')
  }

  const pushToTalkVirtualKey = config.media?.pushToTalkVirtualKey ?? 0x56
  if (!Number.isInteger(pushToTalkVirtualKey) || pushToTalkVirtualKey < 1 || pushToTalkVirtualKey > 255) {
    throw new Error('media.pushToTalkVirtualKey must be a Windows virtual-key code between 1 and 255')
  }

  return {
    host,
    port,
    vision: {
      enabled: config.vision?.enabled ?? true,
      prompt: config.vision?.prompt
        ?? '请观察这张游戏截图，只描述与玩家当前处境和问题相关的事实。不要猜测看不清的内容，使用简洁中文。',
    },
    speech: {
      enabled: config.speech?.enabled ?? true,
      provider: config.speech?.provider ?? 'auto',
      credentialRef: config.speech?.credentialRef ?? 'VOLCENGINE_API_KEY',
      asrResourceId: config.speech?.asrResourceId ?? 'volc.bigasr.auc',
      ttsResourceId: config.speech?.ttsResourceId ?? 'seed-tts-1.0',
      ttsVoice: config.speech?.ttsVoice ?? 'zh_female_shuangkuaisisi_emo_v2_mars_bigtts',
    },
    media: {
      enabled: config.media?.enabled ?? true,
      pushToTalkVirtualKey,
      ...(config.media?.executablePath === undefined ? {} : { executablePath: config.media.executablePath }),
    },
  }
}
