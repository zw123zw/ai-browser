/**
 * Web Speech API 语音引擎
 *
 * 海外用户默认引擎，零配置
 * 基于浏览器原生 SpeechRecognition API
 */

import { Logger } from '@/src/utils/logger'
import type { VoiceEngine, VoiceEngineConfig, VoiceEngineStatus } from './types'

const log = new Logger('WebSpeechEngine')

// Web Speech API 类型声明
interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent {
  error: string
  message: string
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor
    webkitSpeechRecognition: SpeechRecognitionConstructor
  }
}

export class WebSpeechEngine implements VoiceEngine {
  readonly name = 'web-speech'

  private recognition: SpeechRecognitionInstance | null = null
  private _status: VoiceEngineStatus = 'idle'
  private _isActive = false
  private config: Required<VoiceEngineConfig>
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private _paused = false
  /** 上一个错误是 aborted，onend 延迟重启而非立即重启 */
  private _aborted = false

  onResult: ((text: string, isFinal: boolean, confidence: number) => void) | null = null
  onError: ((error: string) => void) | null = null
  onStatusChange: ((status: VoiceEngineStatus) => void) | null = null

  constructor(config?: VoiceEngineConfig) {
    this.config = {
      lang: config?.lang ?? 'zh-CN',
      continuous: config?.continuous ?? true,
      interimResults: config?.interimResults ?? true,
    }
  }

  get isActive(): boolean {
    return this._isActive
  }

  get status(): VoiceEngineStatus {
    return this._status
  }

  /** 检查引擎是否还活着 */
  isAlive(): boolean {
    return this._isActive && this.recognition !== null
  }

  /** 检查浏览器是否支持 */
  static isSupported(): boolean {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  }

  start(): void {
    if (this._isActive) return

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      this.updateStatus('error')
      this.onError?.('当前浏览器不支持语音识别，请使用 Chrome 或 Edge')
      return
    }

    this._aborted = false
    this.recognition = new SpeechRecognition()
    this.recognition.lang = this.config.lang
    this.recognition.continuous = this.config.continuous
    this.recognition.interimResults = this.config.interimResults
    this.recognition.maxAlternatives = 1

    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript.trim()
        const isFinal = result.isFinal
        const confidence = result[0].confidence ?? 0

        if (text) {
          if (isFinal) {
            log.info(`识别完成: "${text}" (confidence=${confidence.toFixed(2)})`)
          }
          this.onResult?.(text, isFinal, confidence)
        }
      }
    }

    this.recognition.onerror = (event: any) => {
      log.warn(`Error: ${event.error}, isActive=${this._isActive}, recognition=${!!this.recognition}`)

      // aborted → 标记，阻止 onend 立即重启（延迟 2s 重试）
      if (event.error === 'aborted') {
        this._aborted = true
        this.clearRestartTimer()
        return
      }

      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        this.scheduleRestart(1000)
        return
      }

      if (event.error === 'not-allowed') {
        this.updateStatus('error')
        this.onError?.('麦克风权限被拒绝，请在浏览器设置中允许')
        this._isActive = false
        return
      }

      if (event.error === 'network') {
        log.warn('网络错误，语音识别需要联网')
        this.onError?.('网络错误，语音识别需要联网')
        this.scheduleRestart(3000)
        return
      }

      this.scheduleRestart(2000)
    }

    this.recognition.onend = () => {
      log.info(`onend fired, isActive=${this._isActive}, paused=${this._paused}, aborted=${this._aborted}`)
      // pause 状态下不重启
      if (this._paused) return

      // aborted 后延迟 2s 重启（避免 300ms 立即重试又撞上竞争者）
      if (this._aborted) {
        this._aborted = false
        if (this._isActive) {
          this.scheduleRestart(2000)
        }
        return
      }

      if (this._isActive && this.config.continuous) {
        this.scheduleRestart(300)
        return
      }

      if (this._isActive) {
        this.scheduleRestart(1000)
      }
    }

    try {
      this.recognition.start()
      this._isActive = true
      this.updateStatus('listening')
      log.info(`Web Speech API 已启动, lang=${this.config.lang}`)
    } catch (e) {
      log.error('启动失败:', e)
      this.updateStatus('error')
      this.onError?.('语音识别启动失败')
    }
  }

  stop(): void {
    log.info('停止语音识别')
    this._isActive = false
    this._paused = false
    this._aborted = false
    this.clearRestartTimer()

    if (this.recognition) {
      try {
        this.recognition.stop()
      } catch {
        // 忽略已停止的错误
      }
      this.recognition = null
    }

    this.updateStatus('idle')
  }

  pause(): void {
    if (this.recognition && this._isActive) {
      this._paused = true
      this.clearRestartTimer()
      try {
        this.recognition.stop()
      } catch {
        // 忽略
      }
      this.updateStatus('processing')
    }
  }

  resume(): void {
    if (this._isActive) {
      this._paused = false
      this.scheduleRestart(100)
    }
  }

  destroy(): void {
    this.stop()
  }

  private updateStatus(status: VoiceEngineStatus): void {
    if (this._status === status) return
    this._status = status
    this.onStatusChange?.(status)
  }

  private scheduleRestart(delay: number): void {
    this.clearRestartTimer()
    log.info(`scheduleRestart(${delay}), isActive=${this._isActive}, recognition=${!!this.recognition}`)
    this.restartTimer = setTimeout(() => {
      if (!this._isActive) {
        log.info('scheduleRestart 跳过: isActive=false')
        return
      }

      if (this.recognition) {
        try {
          this.recognition.start()
          this.updateStatus('listening')
          log.info('scheduleRestart: recognition.start() 成功')
        } catch (e) {
          log.warn('scheduleRestart: recognition.start() 失败', e)
        }
      } else {
        log.warn('scheduleRestart 跳过: recognition=null')
      }
    }, delay)
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }
}
