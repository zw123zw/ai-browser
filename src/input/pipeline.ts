/**
 * 统一输入处理流水线
 *
 * 完整日志覆盖：路由 → Phase 1 → Phase 2 → 标签提取 → 指令执行 → 重试
 *
 * 重试设计：
 * - 所有错误类型（标签提取失败、指令执行失败、need_html）统一处理
 * - 最多重试 5 次
 * - 每次重试：新骨架 + 错误 + HTML 片段 + 已完成指令列表
 * - AI 每次返回完整指令，代码用兜底 key 跳过已完成的
 */

import { Logger } from '@/src/utils/logger'
import { InputRouter } from './router'
import { IntentDetector } from './intent-detector'
import { ActionExecutor } from '@/src/browser/action-executor'
import { SkeletonManager } from '@/src/browser/skeleton'
import { searchByKeywords } from '@/src/browser/local-html'
import { extractTags } from './tag-parser'
import { PHASE2_SYSTEM_PROMPT, buildStreamingUserMessage, MODE_FIRST, MODE_STREAMING, MODE_RETRY, STEPS_INSTRUCTION } from './prompts'
import type { InputContext, PipelineCallbacks } from './types'
import type { AppSettings } from '@/src/types'
import type { Command, SemanticSkeleton } from '@/src/browser/types'

const log = new Logger('Pipeline')

const MAX_RETRY = 5

/** 兜底 key：action + elementId/description/url */
function getCommandKey(cmd: Command): string {
  return `${cmd.action}:${cmd.elementId || cmd.description || cmd.url || ''}`
}

export interface PipelineOptions {
  getSettings: () => AppSettings
  getSkillList?: () => string
  getRecentMessages?: () => Array<{ role: 'user' | 'assistant'; content: string }>
  getSignal?: () => AbortSignal | undefined
  onSkillActivate?: (name: string, userText: string) => Promise<{ success: boolean; message: string }>
  onBuiltinCommand?: (command: string, args: string) => void
}

export class InputPipeline {
  private router: InputRouter
  private detector: IntentDetector
  private executor: ActionExecutor
  private skeletonManager: SkeletonManager
  private options: PipelineOptions

  constructor(options: PipelineOptions) {
    this.options = options
    this.router = new InputRouter()
    this.detector = new IntentDetector({
      getSettings: options.getSettings,
      getSkillList: options.getSkillList,
      getRecentMessages: options.getRecentMessages,
      getSignal: options.getSignal,
    })
    this.executor = new ActionExecutor()
    this.skeletonManager = new SkeletonManager()
  }

  async process(ctx: InputContext, callbacks: PipelineCallbacks): Promise<void> {
    log.info('╔══════════════════════════════════════╗')
    log.info('║       开始处理输入                    ║')
    log.info('╚══════════════════════════════════════╝', {
      text: ctx.text,
      mode: ctx.mode,
      timestamp: new Date().toISOString(),
    })

    // 1. 路由
    const routeResult = this.router.route(ctx)

    if (routeResult.type === 'builtin') {
      log.info('[路由] → 内置命令', { command: routeResult.command, args: routeResult.args })
      this.options.onBuiltinCommand?.(routeResult.command, routeResult.args)
      return
    }

    if (routeResult.type === 'skill') {
      log.info('[路由] → 技能触发（零 AI）', { name: routeResult.skillName, userText: routeResult.skillUserText })
      this.options.onSkillActivate?.(routeResult.skillName, routeResult.skillUserText)
      return
    }

    // 2. Phase 1 — 流式输出，但检测到操作标签时清掉内容，用户只看到"思考中"
    callbacks.onChatStart()
    let phase1StreamedContent = ''
    let phase1ActionTagDetected = false
    const p1 = await this.detector.detectPhase1(ctx.text, (delta, reasoningDelta) => {
      if (reasoningDelta) callbacks.onChatDelta('', reasoningDelta)
      if (delta) {
        phase1StreamedContent += delta
        if (!phase1ActionTagDetected) {
          callbacks.onChatDelta(delta)
          // 检测到操作标签 → 清掉流式内容，只保留"思考中"
          // 关键词必须带 [ 或 ]，防止聊天中提到 "action" 等词误触发
          if (/\[(?:action|command|skill)|(?:action|command|skill)\]/.test(phase1StreamedContent)) {
            phase1ActionTagDetected = true
            callbacks.onChatDelta('', undefined, true)
          }
        }
      }
    })

    if (p1.isChat && p1.responseText) {
      log.info('[流程] Phase 1 → 聊天回复 → 结束')
      // 确认是聊天 → 用回复内容替换"思考中"，标记完成
      callbacks.onChatDelta(p1.responseText)
      callbacks.onChatEnd()
      return
    }

    // 3. Phase 2 — 移除"思考中"消息，只展示解析后的执行结果
    log.info('[流程] Phase 1 → [action] → 进入 Phase 2')
    callbacks.onActionDetected()
    await this.processPhase2WithRetry(ctx.text, callbacks)
  }

  // ═══════════════════════════════════════════════
  // Phase 2 — 流式执行（每次 1 条指令）
  // ═══════════════════════════════════════════════

  private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks): Promise<void> {
    log.info('[Phase 2] ─── 流式执行模式 ───', { maxRetry: MAX_RETRY })

    const completed: Array<{ action: string; elementId?: string; description?: string }> = []
    let totalSteps = -1          // -1 = AI 未返回 [steps]，未知总数
    let consecutiveErrors = 0
    let lastError = ''
    let lastFailedCommand: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null = null
    let lastHtmlFragments: string | null = null

    while (consecutiveErrors < MAX_RETRY) {
      // ★ 双重停止条件 1：[steps] 步数已到
      if (totalSteps > 0 && completed.length >= totalSteps) {
        log.info(`[Phase 2] ═══ [steps] 步数已到 ${totalSteps}，全部完成 ═══`)
        break
      }

      // 每轮重新提取骨架
      const skeleton = this.skeletonManager.getSkeleton()

      log.info(`[Phase 2] ─── 第 ${completed.length + 1} 步 ───`, {
        skeletonElements: skeleton.elements.length,
        completedCount: completed.length,
        totalSteps,
        consecutiveErrors,
      })

      // AI 生成 1 条指令（根据进入模式选择提示词）
      const isFirstEntry = completed.length === 0 && !lastError
      const coreRule = isFirstEntry ? MODE_FIRST : (lastError ? MODE_RETRY : MODE_STREAMING)
      const stepsInstruction = isFirstEntry ? STEPS_INSTRUCTION : ''
      const phase2Result = await this.callStreamingAI(text, skeleton, completed, lastError, lastFailedCommand, lastHtmlFragments, coreRule, stepsInstruction)

      // ★ 首次解析 [steps]，记录总步骤数
      if (phase2Result.steps?.length) {
        totalSteps = phase2Result.steps.length
        log.info(`[Phase 2] [steps] ${totalSteps} 步: ${phase2Result.steps.join(' → ')}`)
      }

      // ── 无标签 → 所有步骤完成或 AI 无输出 ──
      if (!phase2Result.commands?.length && !phase2Result.skill && !phase2Result.needHtml) {
        log.info('[Phase 2] ═══ AI 无更多指令，任务完成 ═══')
        break
      }

      // ── need_html → 搜索 HTML 片段后重试 ──
      if (phase2Result.needHtml) {
        log.info('[Phase 2] → need_html', {
          keywords: phase2Result.needHtml.keywords,
          reason: phase2Result.needHtml.reason,
        })
        const htmlFragments = searchByKeywords(phase2Result.needHtml.keywords)
        log.info('[Phase 2] 关键词搜索结果', { found: !!htmlFragments })
        lastError = `未找到 "${phase2Result.needHtml.description}" 对应元素`
        lastFailedCommand = { action: 'click', description: phase2Result.needHtml.description }
        lastHtmlFragments = htmlFragments
        consecutiveErrors++
        continue
      }

      // ── skill → 执行 ──
      if (phase2Result.skill) {
        const { name, userText } = phase2Result.skill
        log.info('[Phase 2] → 技能触发', { name, userText })
        callbacks.onSkillParsed(name, userText)

        try {
          const result = await this.options.onSkillActivate?.(name, userText)
          if (result && result.success) {
            completed.push({ action: 'skill', elementId: name })
            consecutiveErrors = 0
            lastError = ''
            continue
          }
          lastError = result?.message || `技能 "${name}" 执行失败`
        } catch (error) {
          lastError = `技能异常: ${error instanceof Error ? error.message : String(error)}`
          log.error('[Phase 2] 技能执行异常', error)
        }
        consecutiveErrors++
        continue
      }

      // ── command → 执行单条指令 ──
      const cmd = phase2Result.commands![0]
      log.info('[Phase 2] ── 执行指令 ──', {
        action: cmd.action,
        elementId: cmd.elementId,
        description: cmd.description,
        done: cmd.done,
      })

      callbacks.onCommandsParsed([cmd])
      const result = await this.executor.execute(cmd)

      log.info('[Phase 2] 指令结果', {
        action: cmd.action,
        success: result.success,
        message: result.message,
      })

      callbacks.onCommandResult(cmd.action, result.success, result.message)

      if (result.success) {
        completed.push({ action: cmd.action, elementId: cmd.elementId, description: cmd.description })
        consecutiveErrors = 0
        lastError = ''
        lastFailedCommand = null
        lastHtmlFragments = null

        if (cmd.action === 'navigate') {
          this.skeletonManager.invalidate()
        }

        // ★ 双重停止条件 2：AI 标记 done=1，最后一步
        if (cmd.done === 1) {
          log.info('[Phase 2] ═══ done=1，最后一步完成，停止 ═══')
          break
        }

        // 等待页面更新（弹窗/新内容渲染），再进入下一轮提取骨架
        await new Promise(resolve => setTimeout(resolve, 500))
      } else {
        lastError = `[${cmd.action}] ${result.message}`
        lastFailedCommand = { action: cmd.action, elementId: cmd.elementId, description: cmd.description, text: cmd.text, url: cmd.url }
        consecutiveErrors++
        log.warn('[Phase 2] 指令执行失败', { action: cmd.action, error: lastError })
      }
    }

    // 显示重试消息
    if (lastError && consecutiveErrors < MAX_RETRY) {
      callbacks.onRetryMessage(`🔄 正在重试... (${consecutiveErrors}/${MAX_RETRY})`)
    }

    if (consecutiveErrors >= MAX_RETRY) {
      log.error(`[Phase 2] ═══ 连续 ${MAX_RETRY} 次失败，放弃 ═══`)
      callbacks.onError('未找到对应元素，请准确说出您的需求')
    } else if (completed.length > 0) {
      log.info('[Phase 2] ═══ 流式执行完成 ═══', { totalSteps: completed.length })
      callbacks.onAllCommandsDone?.(text, completed.map(c => ({ action: c.action, elementId: c.elementId })))
    }
  }

  // ═══════════════════════════════════════════════
  // 流式 AI 调用（每次 1 条指令）
  // ═══════════════════════════════════════════════

  private async callStreamingAI(
    text: string,
    skeleton: SemanticSkeleton,
    completed: Array<{ action: string; elementId?: string; description?: string }>,
    lastError: string,
    lastFailedCommand?: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null,
    lastHtmlFragments?: string | null,
    coreRule = MODE_STREAMING,
    stepsInstruction = '',
  ): Promise<import('./intent-detector').Phase2Result> {
    const settings = this.options.getSettings()
    const model = settings.models.find(m => m.id === settings.defaultModelId) || settings.models[0]
    if (!model) {
      log.error('[流式] 未找到可用模型')
      return { rawAiOutput: '' }
    }

    const { createAdapter } = await import('@/src/adapters')
    const adapter = createAdapter(model.provider || settings.provider)

    const skillList = this.options.getSkillList?.() || '（暂无可用技能）'
    const systemPrompt = PHASE2_SYSTEM_PROMPT
      .replace('{coreRule}', coreRule)
      .replace('{stepsInstruction}', stepsInstruction)
      .replace('{skillList}', skillList)
    const userContent = buildStreamingUserMessage(text, skeleton, completed, lastError || undefined, lastFailedCommand || undefined, lastHtmlFragments || undefined)

    log.info('[流式] ═══ AI 请求 ═══', {
      skeletonElements: skeleton.elements.length,
      completedCount: completed.length,
      hasError: !!lastError,
    })

    let fullResponse = ''
    try {
      await adapter.chat(
        {
          baseUrl: model.baseUrl || settings.baseUrl,
          apiKey: model.apiKey || settings.apiKey,
          modelName: model.modelName || settings.defaultModelId,
          messages: [
            { id: Date.now().toString(), role: 'user', content: `${systemPrompt}\n\n${userContent}`, timestamp: Date.now() },
          ],
          signal: this.options.getSignal?.(),
        },
        (chunk) => {
          if (chunk.delta) fullResponse += chunk.delta
        },
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      log.error('[流式] AI 请求失败', error)
      return { rawAiOutput: '' }
    }

    log.info('[流式] ═══ AI 响应 ═══', { responseLength: fullResponse.length })
    log.info('[流式] AI 回复:', fullResponse)

    const tags = extractTags(fullResponse)

    // 流式模式：只取第一条指令
    const firstCommand = tags.commands?.slice(0, 1)

    log.info('[流式] 标签提取', {
      hasCommand: !!firstCommand?.length,
      action: firstCommand?.[0]?.action,
      elementId: firstCommand?.[0]?.elementId,
      description: firstCommand?.[0]?.description,
      done: firstCommand?.[0]?.done,
      hasSkill: !!tags.skill,
      hasNeedHtml: !!tags.needHtml,
      steps: tags.steps,
    })

    return {
      commands: firstCommand,
      skill: tags.skill,
      needHtml: tags.needHtml,
      steps: tags.steps,
      rawAiOutput: fullResponse,
    }
  }
}
