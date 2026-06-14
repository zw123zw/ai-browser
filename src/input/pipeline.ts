/**
 * 统一输入处理流水线
 *
 * 完整日志覆盖：路由 → Phase 1 → Phase 2 → 标签提取 → 指令执行 → 重试
 */

import { Logger } from '@/src/utils/logger'
import { InputRouter } from './router'
import { IntentDetector } from './intent-detector'
import { ActionExecutor } from '@/src/browser/action-executor'
import { SkeletonManager } from '@/src/browser/skeleton'
import { extractTags } from './tag-parser'
import { PHASE2_RETRY_SYSTEM_PROMPT, buildRetryUserMessage } from './prompts'
import type { InputContext, PipelineCallbacks } from './types'
import type { AppSettings } from '@/src/types'
import type { Command, SemanticSkeleton } from '@/src/browser/types'

const log = new Logger('Pipeline')

const MAX_RETRY = 5

export interface PipelineOptions {
  getSettings: () => AppSettings
  getSkillList?: () => string
  getRecentMessages?: () => Array<{ role: 'user' | 'assistant'; content: string }>
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

    // 2. Phase 1 — 流式输出（打字机效果），判断完再决定保留还是移除
    callbacks.onChatStart()
    const p1 = await this.detector.detectPhase1(ctx.text, callbacks.onChatDelta)

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
  // Phase 2 + 重试
  // ═══════════════════════════════════════════════

  private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks): Promise<void> {
    log.info('[Phase 2] ─── 操作决策 + 重试循环 ───', { maxRetry: MAX_RETRY })

    let lastAiOutput = ''
    let lastError = ''
    let lastErrorType: 'extract' | 'exec' = 'extract'

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      const skeleton = this.skeletonManager.getSkeleton()

      log.info(`[Phase 2] ─── 第 ${attempt === 0 ? '首次' : `重试 ${attempt}/${MAX_RETRY}`} ───`, {
        skeletonUrl: skeleton.url,
        skeletonElements: skeleton.elements.length,
        skeletonCached: this.skeletonManager.cachedUrl === skeleton.url,
      })

      // ── 首次 vs 重试 ──
      let phase2Result
      if (attempt === 0) {
        phase2Result = await this.detector.detectPhase2(text, skeleton)
        lastAiOutput = phase2Result.rawAiOutput
      } else {
        callbacks.onRetryMessage(
          lastErrorType === 'extract'
            ? `⚠️ 指令提取失败，重试 ${attempt}/${MAX_RETRY}...`
            : `⚠️ 指令执行失败，重试 ${attempt}/${MAX_RETRY}...`,
        )

        phase2Result = await this.retryPhase2(text, skeleton, lastAiOutput, lastError, lastErrorType)
        if (phase2Result.rawAiOutput) lastAiOutput = phase2Result.rawAiOutput
      }

      // ── 未提取到标签 ──
      if (!phase2Result.commands?.length && !phase2Result.skill && !phase2Result.needHtml) {
        lastError = '未找到有效指令标签 [command]、[skill] 或 [need_html]'
        lastErrorType = 'extract'
        log.warn(`[Phase 2] 标签提取失败`, { attempt: attempt + 1, lastAiOutput: lastAiOutput.slice(0, 200) })
        continue
      }

      // ── 技能触发 ──
      if (phase2Result.skill) {
        const { name, userText } = phase2Result.skill
        log.info('[Phase 2] → 技能触发', { name, userText })
        callbacks.onSkillParsed(name, userText)

        try {
          const result = await this.options.onSkillActivate?.(name, userText)
          log.info('[Phase 2] 技能执行结果', { name, success: result?.success, message: result?.message })
          if (result && !result.success) {
            lastError = `技能 "${name}" 失败: ${result.message}`
            lastErrorType = 'exec'
            continue
          }
          log.info('[Phase 2] ═══ 技能执行成功 ═══')
          return
        } catch (error) {
          lastError = `技能异常: ${error instanceof Error ? error.message : String(error)}`
          lastErrorType = 'exec'
          log.error('[Phase 2] 技能执行异常', error)
          continue
        }
      }

      // ── 浏览器指令 ──
      if (phase2Result.commands?.length) {
        log.info('[Phase 2] → 指令执行', { count: phase2Result.commands.length })
        log.info('[Phase 2] 指令详情:', phase2Result.commands.map(c => ({
          action: c.action,
          elementId: c.elementId,
          description: c.description,
          url: c.url,
          text: c.text,
          key: c.key,
          direction: c.direction,
        })))

        callbacks.onCommandsParsed(phase2Result.commands)

        const execResult = await this.executeCommands(phase2Result.commands, callbacks)
        if (execResult.success) {
          log.info('[Phase 2] ═══ 全部指令执行成功 ═══')
          return
        }

        lastError = execResult.error
        lastErrorType = 'exec'
        log.warn('[Phase 2] 指令执行失败', { error: lastError })
        continue
      }

      // ── need_html ──
      if (phase2Result.needHtml) {
        lastError = `无法找到 "${phase2Result.needHtml.query}" 相关元素`
        lastErrorType = 'extract'
        log.warn('[Phase 2] need_html 兜底失败', { query: phase2Result.needHtml.query })
        continue
      }
    }

    log.error(`[Phase 2] ═══ 超过 ${MAX_RETRY} 次重试上限，放弃 ═══`)
    callbacks.onError(`多次尝试后仍无法完成操作（${MAX_RETRY} 次），请重新描述`)
  }

  // ═══════════════════════════════════════════════
  // 指令执行
  // ═══════════════════════════════════════════════

  private async executeCommands(
    commands: Command[],
    callbacks: PipelineCallbacks,
  ): Promise<{ success: boolean; error: string }> {
    log.info(`[执行] ═══ 开始执行 ${commands.length} 条指令 ═══`)

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]
      log.info(`[执行] ── 第 ${i + 1}/${commands.length} 条 ──`, {
        action: cmd.action,
        elementId: cmd.elementId,
        fallbackSelector: cmd.fallbackSelector,
        description: cmd.description,
        url: cmd.url,
        text: cmd.text,
        key: cmd.key,
        direction: cmd.direction,
        ms: cmd.ms,
      })

      const result = await this.executor.execute(cmd)

      log.info(`[执行] 第 ${i + 1}/${commands.length} 条结果`, {
        action: cmd.action,
        success: result.success,
        message: result.message,
      })

      callbacks.onCommandResult(cmd.action, result.success, result.message)

      if (!result.success) {
        log.warn(`[执行] ═══ 第 ${i + 1} 条失败，中断执行 ═══`, {
          failedAction: cmd.action,
          error: result.message,
        })
        return { success: false, error: `[${cmd.action}] ${result.message}` }
      }

      if (cmd.action === 'navigate') {
        log.info('[执行] navigate 成功，标记骨架失效（下次重试将重新提取）')
        this.skeletonManager.invalidate()
      }
    }

    log.info(`[执行] ═══ 全部 ${commands.length} 条指令执行成功 ═══`)
    return { success: true, error: '' }
  }

  // ═══════════════════════════════════════════════
  // 重试 AI 请求
  // ═══════════════════════════════════════════════

  private async retryPhase2(
    text: string,
    skeleton: SemanticSkeleton,
    lastAiOutput: string,
    lastError: string,
    errorType: 'extract' | 'exec',
  ): Promise<import('./intent-detector').Phase2Result> {
    const settings = this.options.getSettings()
    const model = settings.models.find(m => m.id === settings.defaultModelId) || settings.models[0]
    if (!model) {
      log.error('[重试] 未找到可用模型')
      return { rawAiOutput: '' }
    }

    const { createAdapter } = await import('@/src/adapters')
    const adapter = createAdapter(model.provider || settings.provider)

    // 重试不带会话历史，避免之前失败任务的消息污染当前重试上下文
    const userContent = buildRetryUserMessage(text, skeleton, lastAiOutput, lastError, errorType, [])

    log.info('[重试] ═══ 重试 AI 请求 ═══', {
      errorType,
      skeletonUrl: skeleton.url,
      skeletonElements: skeleton.elements.length,
    })
    log.info('[重试] 重试用户消息:', userContent)

    let fullResponse = ''
    try {
      await adapter.chat(
        {
          baseUrl: model.baseUrl || settings.baseUrl,
          apiKey: model.apiKey || settings.apiKey,
          modelName: model.modelName || settings.defaultModelId,
          messages: [
            { id: Date.now().toString(), role: 'user', content: `${PHASE2_RETRY_SYSTEM_PROMPT}\n\n用户输入: ${userContent}`, timestamp: Date.now() },
          ],
        },
        (chunk) => {
          if (chunk.delta) fullResponse += chunk.delta
        },
      )
    } catch (error) {
      log.error('[重试] AI 请求失败', error)
      return { rawAiOutput: '' }
    }

    log.info('[重试] ═══ 重试 AI 响应 ═══', { responseLength: fullResponse.length })
    log.info('[重试] AI 回复全文:', fullResponse)

    const tags = extractTags(fullResponse)
    log.info('[重试] 标签提取结果', {
      commandsCount: tags.commands?.length || 0,
      commands: tags.commands?.map(c => ({ action: c.action, elementId: c.elementId, description: c.description })),
      skill: tags.skill,
      needHtml: tags.needHtml,
    })

    return {
      commands: tags.commands,
      skill: tags.skill,
      needHtml: tags.needHtml,
      rawAiOutput: fullResponse,
    }
  }
}
