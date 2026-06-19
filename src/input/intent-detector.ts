/**
 * 意图检测器
 *
 * Phase 1: 意图检测（轻量模型）— 只做二分类：聊天 or [action]
 * Phase 2: 操作决策（主力模型）— 从 AI 自然回复中提取 [command]/[need_full]
 */

import { Logger } from '@/src/utils/logger'
import { createAdapter } from '@/src/adapters'
import { extractTags, isChatOnlyReply, getChatText } from './tag-parser'
import {
  PHASE1_SYSTEM_PROMPT,
  PHASE2_SYSTEM_PROMPT,
  buildPhase2UserMessage,
} from './prompts'
import type { AppSettings, ChatMessage } from '@/src/types'
import type { SemanticSkeleton, Command } from '@/src/browser/types'

const log = new Logger('IntentDetector')

export interface IntentDetectorOptions {
  getSettings: () => AppSettings
  /** 获取当前使用的模型 ID（优先会话级，回退全局默认） */
  getModelId?: () => string
  getRecentMessages?: () => Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  getSignal?: () => AbortSignal | undefined
}

export interface Phase1Detection {
  isChat: boolean
  responseText?: string
  rawText: string
  /** Phase 1 直接生成的指令（快速通道，跳过 Phase 2） */
  commands?: Command[]
}

export interface Phase2Result {
  commands?: Command[]
  needFull?: boolean
  rawAiOutput: string
}

export class IntentDetector {
  private options: IntentDetectorOptions

  constructor(options: IntentDetectorOptions) {
    this.options = options
  }

  /**
   * Phase 1: 意图检测
   */
  async detectPhase1(
    text: string,
    onChunk?: (delta: string, reasoningDelta?: string) => void,
  ): Promise<Phase1Detection> {
    log.info('[Phase 1] ─── 开始意图检测 ───', { text: text.slice(0, 100) })

    const aiOutput = await this.callAI('Phase1', PHASE1_SYSTEM_PROMPT, text, onChunk)

    if (!aiOutput) {
      log.warn('[Phase 1] AI 未返回回复，默认当作 [action]')
      return { isChat: false, rawText: '' }
    }

    const tags = extractTags(aiOutput)
    log.info('[Phase 1] 标签提取结果', {
      isAction: tags.isAction,
      hasCommands: !!tags.commands?.length,
      hasChat: !!tags.chatText,
      hasFileTags: tags.hasFileTags,
      fileTagDetails: tags.fileTagDetails,
    })

    // [command] → 快速通道：不需要页面骨架的指令，直接执行
    if (tags.commands?.length && !tags.isAction) {
      log.info('[Phase 1] → 快速通道：[command] 直出', {
        actions: tags.commands.map(c => c.action),
      })
      return { isChat: false, rawText: aiOutput, commands: tags.commands }
    }

    // [action] → 需要操作
    if (tags.isAction) {
      log.info('[Phase 1] → 结果：[action]，进入 Phase 2')
      return { isChat: false, rawText: aiOutput }
    }

    // [FILE:xxx]...[/FILE] → 文件标签，作为聊天回复返回（前端会渲染为文件卡片）
    if (tags.hasFileTags) {
      log.info('[Phase 1] → 结果：文件标签，作为聊天回复返回')
      return { isChat: true, responseText: aiOutput, rawText: aiOutput }
    }

    // 纯聊天
    if (isChatOnlyReply(tags)) {
      const responseText = getChatText(tags)
      log.info('[Phase 1] → 结果：聊天回复', { responseText: responseText.slice(0, 100) })
      return { isChat: true, responseText, rawText: aiOutput }
    }

    log.info('[Phase 1] → 结果：纯文本聊天')
    return { isChat: true, responseText: aiOutput.trim(), rawText: aiOutput }
  }

  /**
   * Phase 2: 操作决策
   */
  async detectPhase2(text: string, skeleton: SemanticSkeleton): Promise<Phase2Result> {
    log.info('[Phase 2] ─── 开始操作决策 ───', { text: text.slice(0, 100) })

    const systemPrompt = PHASE2_SYSTEM_PROMPT
    const userContent = buildPhase2UserMessage(text, skeleton)

    log.info('[Phase 2] 请求参数', {
      skeletonUrl: skeleton.url,
      skeletonElements: skeleton.elements.length,
    })

    const aiOutput = await this.callAI('Phase2', systemPrompt, userContent)

    if (!aiOutput) {
      log.warn('[Phase 2] AI 未返回回复')
      return { rawAiOutput: '' }
    }

    const tags = extractTags(aiOutput)
    log.info('[Phase 2] 标签提取结果', {
      commandsCount: tags.commands?.length || 0,
      commands: tags.commands?.map(c => ({ action: c.action, elementId: c.elementId, description: c.description })),
      needFull: tags.needFull,
    })

    // 提取到有效标签（need_full 由 pipeline 统一处理）
    if (tags.commands?.length || tags.needFull) {
      log.info('[Phase 2] ─── 提取成功 ───')
      return { commands: tags.commands, needFull: tags.needFull, rawAiOutput: aiOutput }
    }

    log.warn('[Phase 2] ─── 未提取到有效标签 ───')
    return { rawAiOutput: aiOutput }
  }

  // ========== AI 调用 ==========

  private async callAI(
    scene: string,
    systemPrompt: string,
    userContent: string,
    onChunk?: (delta: string, reasoningDelta?: string) => void,
  ): Promise<string> {
    const settings = this.options.getSettings()
    const modelId = this.options.getModelId?.() || settings.defaultModelId
    const model = settings.models.find(m => m.id === modelId) || settings.models[0]
    if (!model) {
      log.error(`[${scene}] 未找到可用模型`, { defaultModelId: settings.defaultModelId })
      return ''
    }

    const adapter = createAdapter(model.provider || settings.provider)

    // 构建消息列表：历史上下文 + 当前用户消息
    const messages: ChatMessage[] = []

    // 添加历史上下文（最近 6 条消息，过滤空内容，去掉骨架/HTML避免累积）
    const recentMsgs = this.options.getRecentMessages?.() || []
    let validMsgCount = 0
    for (const msg of recentMsgs) {
      if (msg.content && msg.content.trim()) {
        const cleaned = stripHeavyData(msg.content)
        messages.push({
          id: Date.now().toString(),
          role: msg.role,
          content: cleaned,
          timestamp: Date.now(),
        })
        validMsgCount++
      }
    }

    // 每次都将 system 提示词拼接到用户消息前面（兼容不支持 system role 的 API）
    const finalUserContent = `${systemPrompt}\n\n用户输入: ${userContent}`
    log.info(`[${scene}] 拼接 system 提示词，历史消息 ${validMsgCount} 条`)

    // 添加当前用户消息
    messages.push({
      id: Date.now().toString(),
      role: 'user',
      content: finalUserContent,
      timestamp: Date.now(),
    })

    // ── 完整请求报文日志 ──
    log.info(`[${scene}] ═══ AI 请求 ═══`, {
      provider: model.provider || settings.provider,
      model: model.modelName,
      baseUrl: (model.baseUrl || settings.baseUrl).slice(0, 50),
    })
    log.info(`[${scene}] 系统 Prompt:`, systemPrompt)
    log.info(`[${scene}] 用户消息:`, userContent)
    log.info(`[${scene}] 开始调用 adapter.chat...`)

    let fullResponse = ''
    let reasoningResponse = ''
    let chunkCount = 0
    try {
      await adapter.chat(
        {
          baseUrl: model.baseUrl || settings.baseUrl,
          apiKey: model.apiKey || settings.apiKey,
          modelName: model.modelName || settings.defaultModelId,
          messages,
          signal: this.options.getSignal?.(),
        },
        (chunk) => {
          if (chunk.delta) {
            fullResponse += chunk.delta
            chunkCount++
            // 流式回调
            onChunk?.(chunk.delta)
          }
          if (chunk.reasoningDelta) {
            reasoningResponse += chunk.reasoningDelta
            // 流式回调
            onChunk?.('', chunk.reasoningDelta)
          }
        },
      )
      log.info(`[${scene}] adapter.chat 完成，共收到 ${chunkCount} 个 chunk，thinking 长度: ${reasoningResponse.length}`)
    } catch (error) {
      // AbortError 向上抛，让调用方处理中止逻辑
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }
      log.error(`[${scene}] ═══ AI 请求失败 ═══`, error)
      return ''
    }

    // ── 完整响应报文日志 ──
    const finalResponse = fullResponse || reasoningResponse
    log.info(`[${scene}] ═══ AI 响应 ═══`, {
      responseLength: fullResponse.length,
      reasoningLength: reasoningResponse.length,
      finalLength: finalResponse.length,
      chunkCount,
    })
    log.info(`[${scene}] AI 回复全文:`, finalResponse)

    return finalResponse
  }
}

/**
 * 去掉历史消息中的重数据（骨架 JSON、全页骨架 JSON 等）
 * 保留用户输入和 AI 回复的关键信息，减少 token 消耗
 */
function stripHeavyData(content: string): string {
  let result = content

  // 1. 去掉骨架 JSON（页面骨架: 后面的所有内容，直到双换行或结尾）
  result = result.replace(/页面骨架:\n[\s\S]*?(?=\n\n|$)/g, '页面骨架: [已省略]')

  // 2. 去掉 [全页骨架] 或 [当前页面骨架] JSON
  result = result.replace(/\[(全页|当前页面)骨架\]\n[\s\S]*?(?=\n\n|$)/g, '[$1骨架]: [已省略]')

  return result
}
