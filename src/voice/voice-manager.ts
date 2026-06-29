/**
 * 语音管理器
 *
 * 核心状态机：IDLE → WAKE → COMMAND → PROCESSING → SPEAKING → (循环)
 *
 * 关键设计：引擎永远不 pause，用状态过滤识别结果
 * - processing/speaking 状态 → 忽略所有识别结果
 * - wake 状态 → 检查唤醒词
 * - command 状态 → 入缓冲队列
 */

import { Logger } from '@/src/utils/logger'
import { VoiceBroadcast } from './broadcast'
import { WakeWordDetector } from './wake-word'
import { WebSpeechEngine } from './engines/web-speech-engine'
import type { VoiceEngine, VoiceEngineStatus } from './engines/types'

const log = new Logger('VoiceManager')

const DEFAULT_COMMAND_TIMEOUT = 1500
const DEFAULT_IDLE_TIMEOUT = 3000
/** 唤醒冷却时间：防止同一句话重复触发 */
const WAKE_COOLDOWN = 3000

export type VoiceManagerState = 'idle' | 'wake' | 'command' | 'processing' | 'speaking'

export interface VoiceManagerConfig {
  engineType: 'web-speech' | 'iflytek'
  iflytekConfig: { appId: string; apiKey: string; apiSecret?: string } | undefined
  lang?: string
  wakeWord?: string
  enableTts?: boolean
  ttsRate?: number
  ttsVolume?: number
  bufferTimeout?: number
  idleTimeout?: number

  onStateChange?: (state: VoiceManagerState) => void
  onInterimText?: (text: string) => void
  onUserMessage?: (text: string) => void
  onAssistantMessage?: (text: string) => void
  onError?: (error: string) => void
  /** 打断当前处理（abort pipeline） */
  onAbortProcess?: () => void
  /** 获取播报条件：侧边栏抽屉打开且处于语音助手界面模式 */
  getBroadcastCondition?: () => boolean
}

export class VoiceManager {
  private engine: VoiceEngine | null = null
  private broadcast: VoiceBroadcast
  private wakeWordDetector: WakeWordDetector | null = null
  private _state: VoiceManagerState = 'idle'
  private _isActive = false
  private config: Required<VoiceManagerConfig>
  private handleBroadcastEvent: ((event: Event) => void) | null = null

  private speechBuffer: string[] = []
  private bufferTimer: ReturnType<typeof setTimeout> | null = null
  private lastCommand = ''
  private lastCommandTime = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private lastWakeTime = 0

  onProcessText: ((text: string) => Promise<void>) | null = null

  constructor(config: VoiceManagerConfig) {
    this.config = {
      engineType: config.engineType,
      iflytekConfig: config.iflytekConfig,
      lang: config.lang ?? 'zh-CN',
      wakeWord: config.wakeWord ?? '你好，小灵',
      enableTts: config.enableTts ?? true,
      ttsRate: config.ttsRate ?? 1.5,
      ttsVolume: config.ttsVolume ?? 0.8,
      bufferTimeout: config.bufferTimeout ?? DEFAULT_COMMAND_TIMEOUT,
      idleTimeout: config.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
      onStateChange: config.onStateChange ?? (() => {}),
      onInterimText: config.onInterimText ?? (() => {}),
      onUserMessage: config.onUserMessage ?? (() => {}),
      onAssistantMessage: config.onAssistantMessage ?? (() => {}),
      onError: config.onError ?? (() => {}),
      onAbortProcess: config.onAbortProcess ?? (() => {}),
      getBroadcastCondition: config.getBroadcastCondition ?? (() => true),
    }

    this.broadcast = new VoiceBroadcast({
      lang: this.config.lang,
      rate: this.config.ttsRate,
      volume: this.config.ttsVolume,
    })

    if (this.config.wakeWord) {
      this.wakeWordDetector = new WakeWordDetector(this.config.wakeWord)
    }
  }

  get state(): VoiceManagerState { return this._state }
  get isActive(): boolean { return this._isActive }

  start(): void {
    if (this._isActive) return
    log.info('启动语音管理器', { engineType: this.config.engineType })
    this._isActive = true
    this.createEngine()

    // 监听播报事件
    this.handleBroadcastEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ text: string }>
      if (customEvent.detail?.text) {
        this.speak(customEvent.detail.text)
      }
    }
    window.addEventListener('aib-broadcast', this.handleBroadcastEvent)

    // 始终从 wake 状态开始，等待唤醒词
    this.setState('wake')
    this.engine?.start()
  }

  stop(): void {
    log.info('停止语音管理器')
    this._isActive = false
    this.clearTimers()
    this.broadcast.cancel()
    this.engine?.stop()
    // 移除播报事件监听
    if (this.handleBroadcastEvent) {
      window.removeEventListener('aib-broadcast', this.handleBroadcastEvent)
      this.handleBroadcastEvent = null
    }
    this.setState('idle')
  }

  updateConfig(config: Partial<VoiceManagerConfig>): void {
    if (config.wakeWord !== undefined) this.wakeWordDetector?.setWakeWord(config.wakeWord)
    if (config.enableTts !== undefined) this.config.enableTts = config.enableTts
    if (config.ttsRate !== undefined || config.ttsVolume !== undefined) {
      this.broadcast = new VoiceBroadcast({
        lang: this.config.lang,
        rate: config.ttsRate ?? this.config.ttsRate,
        volume: config.ttsVolume ?? this.config.ttsVolume,
      })
      if (config.ttsRate !== undefined) this.config.ttsRate = config.ttsRate
      if (config.ttsVolume !== undefined) this.config.ttsVolume = config.ttsVolume
    }
    if (config.bufferTimeout !== undefined) this.config.bufferTimeout = config.bufferTimeout
    if (config.idleTimeout !== undefined) this.config.idleTimeout = config.idleTimeout
    // 引擎类型或语言变更 → 重建引擎
    const engineChanged = config.engineType !== undefined && config.engineType !== this.config.engineType
    const langChanged = config.lang !== undefined && config.lang !== this.config.lang
    if (config.engineType !== undefined) this.config.engineType = config.engineType
    if (config.lang !== undefined) this.config.lang = config.lang
    if (config.iflytekConfig !== undefined) this.config.iflytekConfig = config.iflytekConfig
    if ((engineChanged || langChanged) && this._isActive) {
      log.info('引擎配置变更，重建引擎', { engineChanged, langChanged })
      this.engine?.stop()
      this.engine?.destroy()
      this.createEngine()
      this.engine?.start()
    }
  }

  /** 播报文字。播报期间暂停引擎，防止 TTS 声音被识别。 */
  async speak(text: string): Promise<void> {
    if (text && this.config.enableTts && this.canBroadcast()) {
      this.setState('speaking')
      this.engine?.pause()
      await this.broadcast.speak(text)
      // 播报完等 300ms，让用户准备说话
      await new Promise(r => setTimeout(r, 300))
      this.engine?.resume()
    }
    // 只在状态仍是 speaking 时才切换（防止被打断时覆盖 processing 状态）
    if (this._isActive && this._state === 'speaking') {
      this.lastWakeTime = Date.now()
      this.setState('command')
      this.startIdleTimer()
    }
  }

  /** 判断是否可以播报：侧边栏抽屉打开且处于语音助手界面模式 OR alwaysOnVoice 为 true */
  private canBroadcast(): boolean {
    // 如果设置了 getBroadcastCondition 回调，使用它来判断
    if (this.config.getBroadcastCondition) {
      return this.config.getBroadcastCondition()
    }
    // 默认允许播报（保持向后兼容）
    return true
  }

  destroy(): void {
    this.stop()
    this.broadcast.destroy()
    this.engine?.destroy()
    this.engine = null
  }

  // ========== 引擎 ==========

  private createEngine(): void {
    if (this.engine) this.engine.destroy()

    if (this.config.engineType === 'iflytek' && this.config.iflytekConfig) {
      import('./engines/iflytek-engine').then(({ IflytekEngine }) => {
        this.engine = new IflytekEngine(
          this.config.iflytekConfig!,
          { lang: this.config.lang, continuous: true, interimResults: true },
        )
        this.setupEngineCallbacks()
        if (this._isActive) this.engine.start()
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

  private setupEngineCallbacks(): void {
    if (!this.engine) return
    this.engine.onResult = (text, isFinal, confidence) => this.handleResult(text, isFinal, confidence)
    this.engine.onError = (error) => {
      log.error('引擎错误:', error)
      this.config.onError?.(error)
      // 播报错误信息
      this.speak(`语音引擎错误：${error}`)
    }
    this.engine.onStatusChange = (status) => log.debug('引擎状态:', status)
  }

  // ========== 识别结果处理（核心：按状态过滤） ==========

  private handleResult(text: string, isFinal: boolean, _confidence: number): void {
    // === interim 结果 ===
    if (!isFinal) {
      // 只在 wake 状态检查 interim 唤醒词
      if (this._state === 'wake' && this.wakeWordDetector && Date.now() - this.lastWakeTime > WAKE_COOLDOWN) {
        const { matched } = this.wakeWordDetector.matchWakeWord(text, true)
        if (matched) {
          log.info('interim 检测到唤醒词', { text })
          this.onWakeWordDetected()
          return  // 不更新 interimText，onWakeWordDetected 已清空
        }
      }
      // wake 状态下，匹配唤醒词的 interim 不更新显示（避免残留）
      // command 状态下，始终更新（显示用户正在说的话）
      if (this._state === 'wake' && this.wakeWordDetector) {
        const { matched } = this.wakeWordDetector.matchWakeWord(text, true)
        if (matched) return
      }
      this.config.onInterimText?.(text)
      // command 状态下，interim 重置 idle 计时器和 buffer 计时器
      if (this._state === 'command') {
        this.resetIdleTimer()
        // 用户还在说话，不要提前 flush buffer
        if (this.speechBuffer.length > 0) {
          this.resetBufferTimer()
        }
      }
      return
    }

    // === final 结果 ===
    this.config.onInterimText?.('')

    // processing → 缓冲命令，处理完后自动执行（不打断多步骤操作）
    if (this._state === 'processing') {
      if (this.wakeWordDetector) {
        const { matched, command } = this.wakeWordDetector.matchWakeWord(text, false)
        if (matched && !command) {
          log.info('处理中忽略唤醒词', { text })
          return
        }
      }
      log.info('处理中缓冲命令', { text })
      this.bufferCommand(text)
      return
    }

    // speaking → 打断播报
    if (this._state === 'speaking') {
      // 冷却期内的文本很可能是唤醒词的 final 残留（如"你好"、"你好小林"），忽略
      const cooldownOk = Date.now() - this.lastWakeTime > WAKE_COOLDOWN
      if (!cooldownOk) {
        log.info('播报中忽略冷却期内的语音', { text })
        return
      }
      log.info('播报中打断', { text })
      this.broadcast.cancel()
      // 检查是否是唤醒词
      if (this.wakeWordDetector) {
        const { matched, command } = this.wakeWordDetector.matchWakeWord(text, false)
        if (matched && !command) {
          // 纯唤醒词 → 重新进入命令模式
          this.onWakeWordDetected()
          return
        }
        if (matched && command) {
          // 唤醒词+命令 → 提取命令执行
          this.onWakeWordDetected()
          this.bufferCommand(command)
          return
        }
      }
      // 普通命令 → 直接执行
      this.processCommand(text)
      return
    }

    log.info('识别完成', { text, state: this._state })

    if (!this.wakeWordDetector) {
      if (this._state === 'command') this.bufferCommand(text)
      return
    }

    const now = Date.now()
    const cooldownOk = now - this.lastWakeTime > WAKE_COOLDOWN
    const { matched, command } = cooldownOk
      ? this.wakeWordDetector.matchWakeWord(text, false)
      : { matched: false, command: '' }

    // === wake 状态 ===
    if (this._state === 'wake') {
      if (matched) {
        this.onWakeWordDetected()
        if (command) {
          log.info('唤醒词+命令', { command })
          this.bufferCommand(command)
        }
      }
      return
    }

    // === command 状态 ===
    if (this._state === 'command') {
      if (matched) {
        if (command) {
          log.info('唤醒词+命令', { command })
          this.bufferCommand(command)
        } else {
          log.info('再次听到唤醒词，继续等待命令')
          this.playWakeSound()
          this.resetIdleTimer()
        }
        return
      }
      // 先检查是否是唤醒词残留（用 final 严格阈值，避免误杀正常命令）
      if (this.wakeWordDetector) {
        const { matched: isWake } = this.wakeWordDetector.matchWakeWord(text, false)
        if (isWake) {
          log.info('忽略唤醒词残留', { text })
          this.resetIdleTimer()
          return
        }
      }
      this.bufferCommand(text)
    }
  }

  // ========== 唤醒 ==========

  private onWakeWordDetected(): void {
    log.info('进入命令模式，重置所有状态')
    this.lastWakeTime = Date.now()
    // 打断一切：取消 TTS、清空缓冲、重置计时器、清空 interim
    this.broadcast.cancel()
    this.speechBuffer = []
    this.clearTimers()
    this.config.onInterimText?.('')
    this.playWakeSound()
    // 播报"您好，请说"（speaking 状态下仍可缓冲命令）
    this.speak('您好，请说')
  }

  // ========== 语音缓冲 ==========

  private bufferCommand(text: string): void {
    this.speechBuffer.push(text)
    this.resetBufferTimer()
    this.resetIdleTimer()
    log.debug('命令入缓冲', { text, bufferSize: this.speechBuffer.length })
  }

  private resetBufferTimer(): void {
    if (this.bufferTimer) clearTimeout(this.bufferTimer)
    this.bufferTimer = setTimeout(() => this.flushBuffer(), this.config.bufferTimeout)
  }

  private flushBuffer(): void {
    if (this.speechBuffer.length === 0) return

    const combined = this.speechBuffer.join('')
    this.speechBuffer = []

    const now = Date.now()
    if (combined === this.lastCommand && now - this.lastCommandTime < COMMAND_TIMEOUT) {
      log.info('命令去重，跳过', { command: combined })
      return
    }
    this.lastCommand = combined
    this.lastCommandTime = now

    log.info('缓冲合并执行', { command: combined })
    this.processCommand(combined)
  }

  // ========== 超时回退 ==========

  private startIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      if (this._isActive && this._state === 'command') {
        log.info('command 状态超时，回到 wake')
        this.setState('wake')
      }
    }, this.config.idleTimeout)
  }

  private resetIdleTimer(): void {
    if (this._state === 'command') this.startIdleTimer()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  private clearTimers(): void {
    if (this.bufferTimer) { clearTimeout(this.bufferTimer); this.bufferTimer = null }
    this.clearIdleTimer()
  }

  // ========== 命令执行 ==========

  private async processCommand(text: string): Promise<void> {
    log.info('处理命令', { text })
    this.clearTimers()
    this.setState('processing')
    this.config.onUserMessage?.(text)

    try {
      if (this.onProcessText) {
        await this.onProcessText(text)
      }
    } catch (error) {
      log.error('命令处理失败:', error)
      this.config.onError?.(`处理失败: ${error}`)
    } finally {
      if (this._isActive && this._state === 'processing') {
        log.info('processCommand 结束，恢复 command 状态')
        this.lastWakeTime = Date.now()
        // 先保存缓冲的命令（setState('command') 会清空缓冲）
        const buffered = [...this.speechBuffer]
        this.setState('command')
        this.startIdleTimer()
        // 处理完后，立即执行缓冲的命令
        if (buffered.length > 0) {
          const combined = buffered.join('')
          log.info('处理完成，执行缓冲命令', { command: combined })
          this.processCommand(combined)
        }
      }
    }
  }

  // ========== 工具 ==========

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
      // 忽略
    }
  }

  private setState(state: VoiceManagerState): void {
    if (this._state === state) return
    const prevState = this._state
    log.debug(`状态转换: ${prevState} → ${state}`)
    this._state = state
    this.config.onStateChange?.(state)
    // 进入 wake 时清空 interim 文本
    if (state === 'wake') {
      this.config.onInterimText?.('')
    }
    // 进入 command 时清空缓冲（防止唤醒词残留拼接）
    if (state === 'command') {
      this.speechBuffer = []
      if (this.bufferTimer) { clearTimeout(this.bufferTimer); this.bufferTimer = null }
    }
    // 仅从 processing/speaking 回到 wake/command 时检查引擎健康
    if ((state === 'wake' || state === 'command') && this._isActive
      && (prevState === 'processing' || prevState === 'speaking')) {
      this.ensureEngineAlive()
    }
  }

  /** 检查引擎是否还活着，死了就重启 */
  private ensureEngineAlive(): void {
    const alive = this.engine?.isAlive()
    const hasRecognition = (this.engine as any)?.recognition !== null
    log.info('引擎健康检查', { alive, hasRecognition, isActive: this.engine?.isActive, status: this.engine?.status })
    if (alive) return
    log.warn('引擎已死亡，重启中...')
    this.engine?.stop()
    this.engine?.start()
  }
}
