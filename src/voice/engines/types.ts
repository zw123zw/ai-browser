/**
 * 语音引擎统一接口
 *
 * Web Speech API 和讯飞引擎都实现此接口
 */

/** 语音识别状态 */
export type VoiceEngineStatus = 'idle' | 'listening' | 'processing' | 'error'

/** 语音引擎配置 */
export interface VoiceEngineConfig {
  /** 语言，默认 zh-CN */
  lang?: string
  /** 是否连续识别，默认 true */
  continuous?: boolean
  /** 是否返回中间结果，默认 true */
  interimResults?: boolean
}

/** 语音引擎统一接口 */
export interface VoiceEngine {
  /** 引擎名称 */
  readonly name: string

  /** 是否正在运行 */
  readonly isActive: boolean

  /** 当前状态 */
  readonly status: VoiceEngineStatus

  /** 启动识别 */
  start(): void

  /** 停止识别 */
  stop(): void

  /** 暂停识别（AI 处理期间） */
  pause(): void

  /** 恢复识别 */
  resume(): void

  /** 检查引擎是否还活着 */
  isAlive(): boolean

  /** 识别结果回调 */
  onResult: ((text: string, isFinal: boolean, confidence: number) => void) | null

  /** 错误回调 */
  onError: ((error: string) => void) | null

  /** 状态变化回调 */
  onStatusChange: ((status: VoiceEngineStatus) => void) | null

  /** 销毁实例 */
  destroy(): void
}
