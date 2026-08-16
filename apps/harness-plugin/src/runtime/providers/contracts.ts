export interface BinaryAsset {
  bytes: Uint8Array
  mediaType: string
}

export interface MultimodalRequest {
  prompt: string
  images: readonly BinaryAsset[]
}

export interface MultimodalProvider {
  readonly id: string
  analyze(request: MultimodalRequest, signal: AbortSignal): Promise<string>
}

export interface SpeechRecognitionProvider {
  readonly id: string
  transcribe(audio: BinaryAsset, signal: AbortSignal): Promise<string>
}

export interface SpeechSynthesisRequest {
  text: string
  voice?: string
}

export interface SpeechSynthesisProvider {
  readonly id: string
  synthesize(request: SpeechSynthesisRequest, signal: AbortSignal): Promise<BinaryAsset>
}

export interface SpeechCapabilityProvider extends SpeechRecognitionProvider, SpeechSynthesisProvider {
  isAvailable(): Promise<boolean>
}

export interface HostMediaService {
  captureMicrophone(signal: AbortSignal): Promise<BinaryAsset>
  captureForegroundWindow(signal: AbortSignal): Promise<BinaryAsset>
  playAudio(audio: BinaryAsset, signal: AbortSignal): Promise<void>
}
