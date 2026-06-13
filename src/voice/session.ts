/**
 * 语音会话状态机（AI 驱动版）
 *
 * 管理完整的语音交互生命周期：
 * IDLE → LISTENING → PROCESSING → SPEAKING → (常驻循环)
 *
 * 职责：
 * 1. 持有 VoiceRecognition、VoiceBroadcast 实例
 * 2. 监听识别结果，发送给 AI 分析
 * 3. 解析 AI 输出的 【code】 指令标记
 * 4. 串行执行多条指令（静默）
 * 5. 管理状态转换，确保流程正确
 * 6. 处理常驻等待的循环逻辑
 */

import { Logger } from '@/src/utils/logger'
import { VoiceRecognition } from './recognition'
import { SherpaRecognition } from './sherpa-recognition'
import { VoiceBroadcast } from './broadcast'
import { parseBatchCommand } from './commandParser'
import { createAdapter } from '@/src/adapters'
import type { AppSettings, ChatMessage } from '@/src/types'
import type { SessionState, VoiceMessage } from '@/src/stores/voice'
import type { CommandInfo, CommandType } from './commandParser'

const log = new Logger('Session')

/** 最大重试次数 */
const MAX_RETRY = 3

/** 语音指令系统 Prompt */
const COMMAND_SYSTEM_PROMPT = `你是浏览器语音指令助手，根据用户语音、当前页面信息生成可执行指令。

严格遵守以下规则：
1. 所有可执行指令必须使用【code】和【/code】包裹，多条指令分行书写，严格按照用户语音语义顺序排列。
2. 单条指令格式：指令类型:参数；无参指令直接写指令类型。
3. 支持的指令类型：
   open_site:网址        打开指定网站（如 open_site:https://www.bilibili.com）
   search:关键词          全网搜索（如 search:手机）
   site_search:关键词     站内搜索（如 site_search:vue视频）
   open_item:序号         点击页面上第N个链接/结果（如 open_item:3，参数为数字序号）
   page_next              下一页
   page_prev              上一页
   video_play             播放视频
   video_pause            暂停视频
4. 若用户同时说出多个操作，必须逐条分行输出，不可合并、不可打乱顺序。
5. open_site 参数必须是完整 URL（https://开头），不可使用中文别名。
6. open_item 参数必须是数字序号，表示页面上第几个可点击元素。
7. 若语音属于闲聊对话，直接输出简短口语回复（100字内，无Markdown、无代码块）。
8. 仅输出指令或对话，禁止多余解释、注释。`

/** 闲聊系统 Prompt（当用户明确在聊天时使用） */
const CHAT_SYSTEM_PROMPT =
  '你是一个语音助手，用户通过语音和你对话。' +
  '请用简洁的口语化中文回复，适合语音播报，不要使用 Markdown 格式、代码块、表格。' +
  '回复控制在 100 字以内。'

export interface VoiceSessionOptions {
  /** 获取当前设置 */
  getSettings: () => AppSettings
  /** 获取最近语音消息（用于构建上下文） */
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
  executeAutomation: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<{ success: boolean; message: string }>
  /** 获取当前页面上下文（URL + 清洗后 HTML） */
  getPageContext: () => Promise<{ url: string; html: string }>
}

export class VoiceSession {
  private recognition: VoiceRecognition | SherpaRecognition | null = null
  private broadcast: VoiceBroadcast
  private options: VoiceSessionOptions
  private _state: SessionState = 'idle'
  private _isActive = false
  private useSherpa = true // 优先使用 Sherpa 本地识别

  constructor(options: VoiceSessionOptions) {
    this.options = options
    this.broadcast = new VoiceBroadcast({ lang: 'zh-CN', rate: 1.0 })

    // 播报完成 → 回到 IDLE 等待（常驻模式）
    this.broadcast.onEnd = () => {
      this.setState('idle')
      this.toListening()
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

    // 优先使用 Sherpa 本地识别
    if (this.useSherpa) {
      try {
        this.recognition = new SherpaRecognition({
          lang: 'zh-CN',
          continuous: true,
          onResult: (text, isFinal, confidence) => this.handleResult(text, isFinal, confidence),
          onStatusChange: (status) => log.debug('识别状态变化', status),
          onError: (error) => this.handleError(error),
        })
        await this.recognition.start()
        log.info('使用 Sherpa 本地语音识别')
      } catch (error) {
        log.warn('Sherpa 初始化失败，回退到 Web Speech API:', error)
        this.useSherpa = false
        this.initWebSpeech()
      }
    } else {
      this.initWebSpeech()
    }

    this.toListening()

    // 播报欢迎语
    await this.broadcast.speak('请说出指令')
  }

  /** 初始化 Web Speech API */
  private initWebSpeech() {
    this.recognition = new VoiceRecognition({
      lang: 'zh-CN',
      continuous: true,
      interimResults: true,
      onResult: (text, isFinal, confidence) => this.handleResult(text, isFinal, confidence),
      onStatusChange: (status) => log.debug('识别状态变化', status),
      onError: (error) => this.handleError(error),
    })
    this.recognition.start()
    log.info('使用 Web Speech API')
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
    if (!this._isActive) return
    this.setState('listening')
    this.recognition?.resume?.()
  }

  // ========== 识别结果处理 ==========

  private handleResult(text: string, isFinal: boolean, confidence: number) {
    this.options.onTextUpdate(text, isFinal, confidence)

    if (!isFinal) return

    // 最终结果 → 直接处理（无置信度评估）
    log.info('识别完成', { text })
    this.processCommand(text)
  }

  private handleError(error: string) {
    log.error('识别错误', error)

    if (error.includes('麦克风权限')) {
      this.broadcast.speak('麦克风权限被拒绝，请在浏览器设置中允许')
      this.stop()
      return
    }

    // 非致命错误，提示重说
    this.setState('speaking')
    this.broadcast.speak('没有检测到语音，请再说一次')
  }

  // ========== 指令处理 ==========

  private async processCommand(text: string) {
    this.setState('processing')
    this.options.onUserMessage(text)

    // 暂停识别
    this.recognition?.pause?.()

    try {
      // 1. 获取页面上下文
      const { url: pageUrl, html: cleanedHTML } = await this.options.getPageContext()
      log.debug('页面上下文', { url: pageUrl, htmlLength: cleanedHTML.length })

      // 2. 带重试的 AI 分析 + 指令解析
      const result = await this.processWithRetry(text, pageUrl, cleanedHTML)

      // 3. 处理结果
      switch (result.type) {
        case 'commands':
          // 串行执行多条指令（静默）
          await this.executeCommandList(result.commands)
          // 执行完毕，回到 IDLE
          this.toListening()
          break

        case 'chat':
          // 纯对话 → 播报
          this.options.onAssistantMessage(result.text)
          this.setState('speaking')
          await this.broadcast.speak(result.text)
          // broadcast.onEnd 会触发回到 IDLE
          break

        case 'error':
          // 解析失败超限 → 播报错误
          this.options.onAssistantMessage(result.message)
          this.setState('speaking')
          await this.broadcast.speak(result.message)
          // broadcast.onEnd 会触发回到 IDLE
          break
      }
    } catch (error) {
      log.error('处理异常', error)
      const msg = `处理失败: ${error instanceof Error ? error.message : String(error)}`
      this.options.onAssistantMessage(msg)
      this.setState('speaking')
      await this.broadcast.speak('处理失败，请稍后重试')
    }
  }

  // ========== AI 调用 + 重试 ==========

  private async processWithRetry(
    text: string,
    pageUrl: string,
    cleanedHTML: string,
  ): Promise<
    | { type: 'commands'; commands: CommandInfo[] }
    | { type: 'chat'; text: string }
    | { type: 'error'; message: string }
  > {
    let lastAIOutput = ''
    let lastError = ''

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      // 构建请求消息
      const userContent = this.buildUserContent(text, pageUrl, cleanedHTML, lastAIOutput, lastError, attempt)
      const aiOutput = await this.callAI(userContent)

      if (!aiOutput) {
        lastError = 'AI 未返回有效回复'
        log.warn('AI 未返回回复，准备重试', { attempt: attempt + 1 })
        continue
      }

      lastAIOutput = aiOutput

      // 解析指令
      const parseResult = parseBatchCommand(aiOutput)

      // 解析成功 → 返回指令列表
      if (!parseResult.hasError && parseResult.commandList.length > 0) {
        log.info('解析成功', { total: parseResult.total })
        return { type: 'commands', commands: parseResult.commandList }
      }

      // 纯对话 → 返回对话文本
      if (parseResult.plainText && parseResult.commandList.length === 0) {
        log.info('判定为纯对话')
        return { type: 'chat', text: parseResult.plainText }
      }

      // 解析失败 → 准备重试
      lastError = parseResult.errorMsg || '未解析出有效指令'
      log.warn(`解析失败，重试 ${attempt + 1}/${MAX_RETRY}`, { lastError })
    }

    // 超过重试上限
    log.error('解析失败，超过重试上限')
    return { type: 'error', message: '指令解析失败，请重新下达指令' }
  }

  private buildUserContent(
    text: string,
    pageUrl: string,
    cleanedHTML: string,
    lastAIOutput: string,
    lastError: string,
    attempt: number,
  ): string {
    // 构建最近 3 轮上下文
    const recentMsgs = this.options.getRecentMessages().slice(-3)
    const recentContext = recentMsgs
      .map((m) => {
        const label = m.role === 'user' ? '用户' : '执行结果'
        return `${label}: ${m.content}`
      })
      .join('\n')

    const parts = [
      recentContext ? `历史对话:\n${recentContext}` : '',
      `当前用户语音: "${text}"`,
      `当前页面URL: ${pageUrl}`,
      `页面HTML:\n${cleanedHTML}`,
    ]

    // 重试时附加错误详情，让 AI 自我修正
    if (attempt > 0 && lastAIOutput) {
      parts.push(`你上一次的回复:\n${lastAIOutput}`)
      parts.push(`解析错误: ${lastError}`)
      parts.push('请根据错误信息修正指令格式，重新输出。')
    }

    return parts.filter(Boolean).join('\n\n')
  }

  private async callAI(userContent: string): Promise<string> {
    const settings = this.options.getSettings()
    const model = settings.models.find(m => m.id === settings.defaultModelId) || settings.models[0]
    const adapter = createAdapter(model?.provider || settings.provider)

    const llmMessages: ChatMessage[] = [
      {
        id: 'system',
        role: 'system',
        content: COMMAND_SYSTEM_PROMPT,
        timestamp: Date.now(),
      },
      {
        id: Date.now().toString(),
        role: 'user',
        content: userContent,
        timestamp: Date.now(),
      },
    ]

    log.debug('发起 AI 请求', {
      provider: model?.provider || settings.provider,
      model: model?.modelName || settings.defaultModelId,
      contentLength: userContent.length,
    })

    let fullResponse = ''
    await adapter.chat(
      {
        baseUrl: model?.baseUrl || settings.baseUrl,
        apiKey: model?.apiKey || settings.apiKey,
        modelName: model?.modelName || settings.defaultModelId,
        messages: llmMessages,
      },
      (chunk) => {
        if (chunk.delta) {
          fullResponse += chunk.delta
        }
      },
    )

    log.debug('AI 回复', {
      length: fullResponse.length,
      preview: fullResponse.slice(0, 100),
    })

    return fullResponse
  }

  // ========== 多指令串行执行 ==========

  private async executeCommandList(commands: CommandInfo[]): Promise<void> {
    log.info(`开始执行 ${commands.length} 条指令`)

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]
      log.info(`执行第 ${i + 1}/${commands.length} 条指令`, { type: cmd.type, params: cmd.params })

      try {
        const params = this.buildActionParams(cmd)
        const result = await this.options.executeAutomation(cmd.type, params)
        log.info(`第 ${i + 1} 条指令执行完成`, { success: result.success })

        if (!result.success) {
          log.warn(`第 ${i + 1} 条指令执行失败: ${result.message}`)
        }
      } catch (error) {
        log.error(`第 ${i + 1} 条指令执行异常`, error)
        // 继续执行后续指令，不中断
      }
    }

    log.info('全部指令执行完毕，回到等待状态')
  }

  private buildActionParams(cmd: CommandInfo): Record<string, unknown> {
    switch (cmd.type) {
      case 'open_site':
        return { url: cmd.params }
      case 'search':
      case 'site_search':
        return { keyword: cmd.params }
      case 'open_item':
        return { index: parseInt(cmd.params, 10) || 1 }
      default:
        return {}
    }
  }
}
