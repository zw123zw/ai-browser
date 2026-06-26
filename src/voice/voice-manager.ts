/**
 * 语音管理器
 *
 * 核心状态机：IDLE → WAKE → COMMAND → PROCESSING → SPEAKING → (循环)
 * 整合引擎、唤醒词、TTS、管线
 */

import { Logger } from '@/src/utils/logger'
import { VoiceBroadcast } from './broadcast'
import { WakeWordDetector } from './wake-word'
import { WebSpeechEngine } from './engines/web-speech-engine'
import type { VoiceEngine, VoiceEngineStatus } from './engines/types'

const log = new Logger('VoiceManager')

/** 语音管理器状态 */
export type VoiceManagerState = 'idle' | 'wake' | 'command' | 'processing' | 'speaking'

/** 语音管理器配置 */
export interface VoiceManagerConfig {
  /** 引擎类型 */
  engineType: 'web-speech' | 'iflytek'
  /** 讯飞配置（engineType=iflytek 时必填） */
  iflytekConfig: {
    appId: string
    apiKey: string
    apiSecret?: string
  } | undefined
  /** 识别语言 */
  lang?: string
  /** 唤醒词 */
  wakeWord?: string
  /** 是否启用唤醒词 */
  enableWakeWord?: boolean
  /** 是否启用 TTS */
  enableTts?: boolean
  /** TTS 语速 */
  ttsRate?: number
  /** TTS 音量 */
  ttsVolume?: number
  /** 是否自动启动监听 */
  autoStart?: boolean

  // 回调
  /** 状态变化回调 */
  onStateChange?: (state: VoiceManagerState) => void
  /** interim 文本更新回调 */
  onInterimText?: (text: string) => void
  /** 用户消息回调 */
  onUserMessage?: (text: string) => void
  /** 助手消息回调 */
  onAssistantMessage?: (text: string) => void
  /** 错误回调 */
  onError?: (error: string) => void
}

export class VoiceManager {
  private engine: VoiceEngine | null = null
  private broadcast: VoiceBroadcast
  private wakeWordDetector: WakeWordDetector | null = null
  private _state: VoiceManagerState = 'idle'
  private _isActive = false
  private config: Required<VoiceManagerConfig>

  /** 处理用户文字的回调（接入 InputPipeline） */
  onProcessText: ((text: string) => Promise<void>) | null = null

  constructor(config: VoiceManagerConfig) {
    this.config = {
      engineType: config.engineType,
      iflytekConfig: config.iflytekConfig,
      lang: config.lang ?? 'zh-CN',
      wakeWord: config.wakeWord ?? '你好，小灵',
      enableWakeWord: config.enableWakeWord ?? true,
      enableTts: config.enableTts ?? true,
      ttsRate: config.ttsRate ?? 1.0,
      ttsVolume: config.ttsVolume ?? 0.8,
      autoStart: config.autoStart ?? false,
      onStateChange: config.onStateChange ?? (() => {}),
      onInterimText: config.onInterimText ?? (() => {}),
      onUserMessage: config.onUserMessage ?? (() => {}),
      onAssistantMessage: config.onAssistantMessage ?? (() => {}),
      onError: config.onError ?? (() => {}),
    }

    this.broadcast = new VoiceBroadcast({
      lang: this.config.lang,
      rate: this.config.ttsRate,
      volume: this.config.ttsVolume,
    })

    if (this.config.enableWakeWord && this.config.wakeWord) {
      this.wakeWordDetector = new WakeWordDetector(this.config.wakeWord)
    }
  }

  get state(): VoiceManagerState {
    return this._state
  }

  get isActive(): boolean {
    return this._isActive
  }

  /** 启动监听 */
  start(): void {
    if (this._isActive) return

    log.info('启动语音管理器', { engineType: this.config.engineType })
    this._isActive = true

    // 创建引擎
    this.createEngine()

    if (this.config.enableWakeWord && this.wakeWordDetector) {
      // 唤醒词模式：先监听唤醒词
      this.setState('wake')
      this.engine?.start()
    } else {
      // 无唤醒词模式：直接进入命令模式
      this.setState('command')
      this.engine?.start()
    }
  }

  /** 停止监听 */
  stop(): void {
    log.info('停止语音管理器')
    this._isActive = false
    this.broadcast.cancel()
    this.engine?.stop()
    this.setState('idle')
  }

  /** 更新配置（设置变更时调用） */
  updateConfig(config: Partial<VoiceManagerConfig>): void {
    if (config.wakeWord !== undefined) {
      this.wakeWordDetector?.setWakeWord(config.wakeWord)
    }
    if (config.enableTts !== undefined) {
      this.config.enableTts = config.enableTts
    }
    if (config.ttsRate !== undefined) {
      this.config.ttsRate = config.ttsRate
      this.broadcast = new VoiceBroadcast({
        lang: this.config.lang,
        rate: config.ttsRate,
        volume: this.config.ttsVolume,
      })
    }
    if (config.ttsVolume !== undefined) {
      this.config.ttsVolume = config.ttsVolume
      this.broadcast = new VoiceBroadcast({
        lang: this.config.lang,
        rate: this.config.ttsRate,
        volume: config.ttsVolume,
      })
    }
    if (config.wakeWord !== undefined && this.wakeWordDetector) {
      this.wakeWordDetector.setWakeWord(config.wakeWord)
    }
  }

  /** 播报文字（供外部调用） */
  async speak(text: string): Promise<void> {
    if (!this.config.enableTts) return
    this.setState('speaking')
    await this.broadcast.speak(text)
    if (this._isActive) {
      this.setState(this.config.enableWakeWord ? 'wake' : 'command')
      this.engine?.resume()
    }
  }

  /** 销毁 */
  destroy(): void {
    this.stop()
    this.broadcast.destroy()
    this.engine?.destroy()
    this.engine = null
  }

  // ========== 内部方法 ==========

  /** 创建引擎 */
  private createEngine(): void {
    if (this.engine) {
      this.engine.destroy()
    }

    if (this.config.engineType === 'iflytek' && this.config.iflytekConfig) {
      // 动态导入讯飞引擎
      import('./engines/iflytek-engine').then(({ IflytekEngine }) => {
        this.engine = new IflytekEngine(
          this.config.iflytekConfig!,
          { lang: this.config.lang, continuous: true, interimResults: true },
        )
        this.setupEngineCallbacks()
        if (this._isActive) {
          this.engine.start()
        }
      }).catch((error) => {
        log.error('加载讯飞引擎失败:', error)
        this.config.onError?.('加载讯飞引擎失败')
      })
    } else {
      this.engine = new WebSpeechEngine({
        lang: this.config.lang,
        continuous: true,
        interimResults: true,
      })
      this.setupEngineCallbacks()
    }
  }

  /** 设置引擎回调 */
  private setupEngineCallbacks(): void {
    if (!this.engine) return

    this.engine.onResult = (text, isFinal, confidence) => {
      this.handleResult(text, isFinal, confidence)
    }

    this.engine.onError = (error) => {
      log.error('引擎错误:', error)
      this.config.onError?.(error)
    }

    this.engine.onStatusChange = (status) => {
      log.debug('引擎状态:', status)
    }
  }

  /** 处理识别结果 */
  private handleResult(text: string, isFinal: boolean, _confidence: number): void {
    // 更新 interim 文本
    this.config.onInterimText?.(isFinal ? '' : text)

    if (!isFinal) {
      // interim 结果：检查唤醒词
      if (this._state === 'wake' && this.wakeWordDetector?.check(text)) {
        log.info('检测到唤醒词', { text })
        this.onWakeWordDetected()
      }
      return
    }

    // final 结果
    log.info('识别完成', { text, state: this._state })

    if (this._state === 'wake') {
      // 唤醒词模式下，检查是否包含唤醒词
      if (this.wakeWordDetector?.check(text)) {
        const command = this.wakeWordDetector.extractCommand(text)
        if (command) {
          // "你好，小灵 打开B站" → 直接执行命令
          log.info('唤醒词+命令', { command })
          this.processCommand(command)
        } else {
          // "你好，小灵" → 进入命令模式，等待下一句
          log.info('唤醒词，等待命令')
          this.onWakeWordDetected()
        }
      }
      // 没有唤醒词，忽略
      return
    }

    if (this._state === 'command') {
      // 命令模式：处理命令
      this.processCommand(text)
    }
  }

  /** 唤醒词检测到 */
  private onWakeWordDetected(): void {
    log.info('进入命令模式')
    this.setState('command')
    // 播放提示音（简短的 beep）
    this.playWakeSound()
  }

  /** 处理命令 */
  private async processCommand(text: string): Promise<void> {
    log.info('处理命令', { text })
    this.setState('processing')
    this.engine?.pause()
    this.config.onUserMessage?.(text)

    try {
      // 调用外部管线处理
      if (this.onProcessText) {
        await this.onProcessText(text)
      }
    } catch (error) {
      log.error('命令处理失败:', error)
      this.config.onError?.(`处理失败: ${error}`)
    } finally {
      // 处理完毕，回到监听状态
      if (this._isActive) {
        if (this.config.enableWakeWord) {
          this.setState('wake')
        } else {
          this.setState('command')
        }
        this.engine?.resume()
      }
    }
  }

  /** 播放唤醒提示音 */
  private playWakeSound(): void {
    try {
      const audioContext = new AudioContext()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      oscillator.frequency.value = 800
      oscillator.type = 'sine'
      gainNode.gain.value = 0.1

      oscillator.start()
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3)
      oscillator.stop(audioContext.currentTime + 0.3)
    } catch {
      // 忽略音频播放错误
    }
  }

  /** 设置状态 */
  private setState(state: VoiceManagerState): void {
    if (this._state === state) return
    log.debug(`状态转换: ${this._state} → ${state}`)
    this._state = state
    this.config.onStateChange?.(state)
  }
}
