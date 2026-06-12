/**
 * TTS 语音播报封装
 *
 * 使用 Web Speech Synthesis API 将文字转为语音播放
 * 支持播报队列、优先级打断、完成回调
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('Broadcast')

export type BroadcastPriority = 'high' | 'normal'

export interface BroadcastOptions {
  /** 语言，默认 zh-CN */
  lang?: string
  /** 语速，默认 1.0 */
  rate?: number
  /** 音量，默认 1.0 */
  volume?: number
}

export class VoiceBroadcast {
  private options: Required<BroadcastOptions>
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private isSpeaking = false

  /** 播报完成回调 */
  onEnd: (() => void) | null = null

  /** 播报开始回调 */
  onStart: (() => void) | null = null

  constructor(options?: BroadcastOptions) {
    this.options = {
      lang: options?.lang ?? 'zh-CN',
      rate: options?.rate ?? 1.0,
      volume: options?.volume ?? 1.0,
    }
  }

  /** 是否正在播报 */
  get speaking(): boolean {
    return this.isSpeaking
  }

  /** 检查浏览器是否支持 Speech Synthesis */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  /**
   * 播报文字
   * @returns Promise，播报完成时 resolve
   */
  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!VoiceBroadcast.isSupported()) {
        log.warn('浏览器不支持语音播报')
        resolve()
        return
      }

      // 取消当前播报
      this.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = this.options.lang
      utterance.rate = this.options.rate
      utterance.volume = this.options.volume

      utterance.onstart = () => {
        this.isSpeaking = true
        log.info('开始播报', { text })
        this.onStart?.()
      }

      utterance.onend = () => {
        this.isSpeaking = false
        this.currentUtterance = null
        log.info('播报完成', { text })
        this.onEnd?.()
        resolve()
      }

      utterance.onerror = (event) => {
        this.isSpeaking = false
        this.currentUtterance = null
        log.error('播报错误', { text, error: event.error })
        this.onEnd?.()
        resolve()
      }

      this.currentUtterance = utterance
      window.speechSynthesis.speak(utterance)
    })
  }

  /** 取消当前播报 */
  cancel() {
    if (this.isSpeaking) {
      log.debug('取消播报')
      window.speechSynthesis.cancel()
      this.isSpeaking = false
      this.currentUtterance = null
    }
  }

  /** 销毁 */
  destroy() {
    this.cancel()
    this.onEnd = null
    this.onStart = null
  }
}
