/**
 * 语音会话状态机
 *
 * 管理完整的语音交互生命周期：
 * IDLE → LISTENING → EVALUATING → PROCESSING → SPEAKING → (循环)
 *
 * 职责：
 * 1. 持有 VoiceRecognition、VoiceBroadcast 实例
 * 2. 监听识别结果，评估置信度
 * 3. 调用 commandParser 解析指令
 * 4. 调用 adapter 发送 LLM / 调用自动化执行
 * 5. 调用 broadcast 播报结果
 * 6. 管理状态转换，确保流程正确
 * 7. 处理连续模式的循环逻辑
 */

import { Logger } from '@/src/utils/logger'
import { VoiceRecognition } from './recognition'
import { VoiceBroadcast } from './broadcast'
import { parseVoiceCommand } from './commandParser'
import { createAdapter } from '@/src/adapters'
import type { AppSettings } from '@/src/types'
import type { ChatMessage } from '@/src/types'
import type { SessionState, VoiceMessage } from '@/src/stores/voice'

const log = new Logger('Session')

/** 置信度阈值 */
const CONFIDENCE_HIGH = 0.8
const CONFIDENCE_MEDIUM = 0.6

/** 语音模式 AI 系统提示 */
const VOICE_SYSTEM_PROMPT =
  '你是一个语音助手，用户通过语音和你对话。' +
  '请用简洁的口语化中文回复，适合语音播报，不要使用 Markdown 格式、代码块、表格。' +
  '回复控制在 100 字以内。'

export interface VoiceSessionOptions {
  /** 获取当前设置 */
  getSettings: () => AppSettings
  /** 获取最近语音消息（用于构建 LLM 上下文） */
  getRecentMessages: () => VoiceMessage[]
  /** 状态变化回调 */
  onStateChange: (state: SessionState) => void
  /** 识别文本更新回调 */
  onTextUpdate: (text: string, isFinal: boolean, confidence: number) => void
  /** 添加用户消息到 UI */
  onUserMessage: (text: string) => void
  /** 添加助手消息到 UI */
  onAssistantMessage: (content: string, actionResult?: VoiceMessage['actionResult']) => void
  /** 添加系统消息到 UI */
  onSystemMessage: (content: string) => void
  /** 执行自动化指令（注入到 content script） */
  executeAutomation: (action: string, params: Record<string, unknown>) => Promise<{ success: boolean; message: string }>
}

export class VoiceSession {
  private recognition: VoiceRecognition | null = null
  private broadcast: VoiceBroadcast
  private options: VoiceSessionOptions
  private _state: SessionState = 'idle'
  private _isActive = false

  constructor(options: VoiceSessionOptions) {
    this.options = options
    this.broadcast = new VoiceBroadcast({ lang: 'zh-CN', rate: 1.0 })

    // 播报完成 → 进入下一轮聆听
    this.broadcast.onEnd = () => {
      this.setSpeaking(false)
      if (this._isActive && this.options.getSettings()) {
        this.toListening()
      }
    }
  }

  /** 当前状态 */
  get state(): SessionState {
    return this._state
  }

  /** 是否运行中 */
  get isActive(): boolean {
    return this._isActive
  }

  /** 启动语音会话 */
  async start() {
    if (this._isActive) return

    log.info('启动语音会话')
    this._isActive = true

    // 初始化识别器
    this.recognition = new VoiceRecognition({
      lang: 'zh-CN',
      continuous: true,
      interimResults: true,
      onResult: (text, isFinal, confidence) => this.handleResult(text, isFinal, confidence),
      onStatusChange: (status) => log.debug('识别状态变化', status),
      onError: (error) => this.handleError(error),
    })

    this.recognition.start()
    this.toListening()

    // 播报欢迎语
    await this.broadcast.speak('请说出指令')
  }

  /** 停止语音会话 */
  stop() {
    log.info('停止语音会话')
    this._isActive = false
    this.broadcast.cancel()
    this.recognition?.stop()
    this.recognition = null
    this.setState('idle')
  }

  /** 销毁 */
  destroy() {
    this.stop()
    this.broadcast.destroy()
  }

  // ========== 状态转换 ==========

  private setState(state: SessionState) {
    if (this._state === state) return
    log.debug(`状态转换: ${this._state} → ${state}`)
    this._state = state
    this.options.onStateChange(state)
  }

  private toListening() {
    this.setState('listening')
    this.recognition?.resume?.()
  }

  private setSpeaking(value: boolean) {
    this.options.onStateChange?.(value ? 'speaking' : 'idle')
  }

  // ========== 识别结果处理 ==========

  private handleResult(text: string, isFinal: boolean, confidence: number) {
    this.options.onTextUpdate(text, isFinal, confidence)

    if (!isFinal) return

    // 最终结果 → 进入置信度评估
    this.setState('evaluating')
    this.evaluateConfidence(text, confidence)
  }

  private evaluateConfidence(text: string, confidence: number) {
    log.info(`置信度评估: "${text}" confidence=${confidence.toFixed(2)}`)

    if (confidence >= CONFIDENCE_HIGH) {
      // 高置信度 → 直接处理
      log.debug('高置信度，直接处理')
      this.processCommand(text)
    } else if (confidence >= CONFIDENCE_MEDIUM) {
      // 中置信度 → 语音确认
      log.debug('中置信度，语音确认')
      this.broadcast.speak(`你是说 ${text} 吗？请确认或重说`)
    } else {
      // 低置信度 → 提示重说
      log.debug('低置信度，提示重说')
      this.broadcast.speak('没听清，请再说一次')
    }
  }

  private handleError(error: string) {
    log.error('识别错误', error)

    if (error.includes('麦克风权限')) {
      this.broadcast.speak('麦克风权限被拒绝，请在浏览器设置中允许')
      this.stop()
      return
    }

    // 非致命错误，提示重说
    this.broadcast.speak('没有检测到语音，请再说')
  }

  // ========== 指令处理 ==========

  private async processCommand(text: string) {
    this.setState('processing')
    this.options.onUserMessage(text)

    const command = parseVoiceCommand(text)
    log.info('指令解析结果', command)

    if (command.type === 'automation') {
      await this.executeAutomation(command.action, command.params)
    } else {
      await this.sendToAI(command.text)
    }
  }

  private async executeAutomation(action: string, params: Record<string, unknown>) {
    log.info(`执行自动化: ${action}`, params)

    // 暂停识别
    this.recognition?.pause?.()

    try {
      const result = await this.options.executeAutomation(action, params)
      log.info('自动化结果', result)

      this.options.onAssistantMessage(result.message, {
        action,
        success: result.success,
        message: result.message,
      })

      // 播报结果
      this.setState('speaking')
      await this.broadcast.speak(result.message)
    } catch (error) {
      log.error('自动化执行失败', error)
      const msg = '操作执行失败'
      this.options.onAssistantMessage(msg, { action, success: false, message: String(error) })
      this.setState('speaking')
      await this.broadcast.speak(msg)
    }
  }

  private async sendToAI(text: string) {
    log.info('发送给 AI', { text })

    // 暂停识别
    this.recognition?.pause?.()

    try {
      const settings = this.options.getSettings()
      const adapter = createAdapter(settings.provider)

      // 构建消息：系统提示 + 最近对话
      const recentVoiceMsgs = this.options.getRecentMessages()
      const llmMessages: ChatMessage[] = [
        {
          id: 'system',
          role: 'system' as const,
          content: VOICE_SYSTEM_PROMPT,
          timestamp: Date.now(),
        },
        ...recentVoiceMsgs
          .filter((m) => m.role !== 'system')
          .slice(-6)
          .map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
          })),
        {
          id: Date.now().toString(),
          role: 'user' as const,
          content: text,
          timestamp: Date.now(),
        },
      ]

      log.debug('LLM 请求', {
        provider: settings.provider,
        model: settings.defaultModelId,
        messageCount: llmMessages.length,
      })

      let fullResponse = ''
      await adapter.chat(
        {
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          modelName: settings.defaultModelId,
          messages: llmMessages,
        },
        (chunk) => {
          if (chunk.delta) {
            fullResponse += chunk.delta
          }
        }
      )

      if (fullResponse) {
        log.info('AI 回复', { length: fullResponse.length, preview: fullResponse.slice(0, 50) })
        this.options.onAssistantMessage(fullResponse)

        // 播报 AI 回复
        this.setState('speaking')
        await this.broadcast.speak(fullResponse)
      } else {
        log.warn('AI 未返回有效回复')
        this.options.onAssistantMessage('AI 未返回有效回复')
        this.setState('speaking')
        await this.broadcast.speak('AI 没有返回回复')
      }
    } catch (error) {
      log.error('AI 请求失败', error)
      const msg = `AI 请求失败: ${error instanceof Error ? error.message : String(error)}`
      this.options.onAssistantMessage(msg)
      this.setState('speaking')
      await this.broadcast.speak('AI 请求失败，请稍后重试')
    }
  }
}
