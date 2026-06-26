// 引擎
export type { VoiceEngine, VoiceEngineConfig, VoiceEngineStatus } from './engines/types'
export { WebSpeechEngine } from './engines/web-speech-engine'
export { IflytekEngine } from './engines/iflytek-engine'
export type { IflytekConfig } from './engines/iflytek-engine'

// 唤醒词
export { WakeWordDetector } from './wake-word'

// TTS
export { VoiceBroadcast } from './broadcast'
export type { BroadcastPriority, BroadcastOptions } from './broadcast'

// 管理器
export { VoiceManager } from './voice-manager'
export type { VoiceManagerState, VoiceManagerConfig } from './voice-manager'
