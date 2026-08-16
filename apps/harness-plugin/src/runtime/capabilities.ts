export const REQUIRED_ENGINE_CAPABILITIES = [
  'multimodal-understanding',
  'speech-recognition',
  'speech-synthesis',
  'microphone-capture',
  'audio-playback',
] as const

export type RequiredEngineCapability = typeof REQUIRED_ENGINE_CAPABILITIES[number]

export interface CapabilityStatus {
  capability: RequiredEngineCapability
  ready: boolean
  provider?: string
  reason?: string
}

export function missingRequiredCapabilities(statuses: readonly CapabilityStatus[]): RequiredEngineCapability[] {
  const ready = new Set(
    statuses
      .filter(status => status.ready)
      .map(status => status.capability),
  )
  return REQUIRED_ENGINE_CAPABILITIES.filter(capability => !ready.has(capability))
}
