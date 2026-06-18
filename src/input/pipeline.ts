/**
 * 统一输入处理流水线
 *
 * 完整日志覆盖：路由 → Phase 1 → Phase 2 → 标签提取 → 指令执行 → 重试
 *
 * 重试设计：
 * - 所有错误类型（标签提取失败、指令执行失败、need_full）统一处理
 * - 最多重试 5 次
 * - 每次重试：新骨架 + 错误 + HTML 片段 + 已完成指令列表
 * - AI 每次返回完整指令，代码用兜底 key 跳过已完成的
 */

import { Logger } from '@/src/utils/logger'
import { InputRouter } from './router'
import { IntentDetector } from './intent-detector'
import { ActionExecutor } from '@/src/browser/action-executor'
import { SkeletonManager } from '@/src/browser/skeleton'
import { extractFullPageSkeleton } from '@/src/browser/local-html'
import { extractTags } from './tag-parser'
import { PHASE2_SYSTEM_PROMPT, buildStreamingUserMessage, MODE_FIRST, MODE_STREAMING, MODE_RETRY } from './prompts'
import type { InputContext, PipelineCallbacks } from './types'
import type { AppSettings } from '@/src/types'
import type { Command, SemanticSkeleton } from '@/src/browser/types'

const log = new Logger('Pipeline')

const MAX_RETRY = 5

/** abort-aware sleep：等待期间可被 AbortSignal 中断 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }, { once: true })
  })
}

export interface PipelineOptions {
  getSettings: () => AppSettings
  /** 获取当前使用的模型 ID（优先会话级，回退全局默认） */
  getModelId?: () => string
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
      getModelId: options.getModelId,
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
      // 用清理后的最终文本替换流式内容（可能去掉了 [chat] 标签）
      callbacks.onChatDelta('', undefined, true)
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
    const completedKeys = new Set<string>()  // 指令去重 key 集合
    let consecutiveErrors = 0
    let lastError = ''
    let lastFailedCommand: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null = null
    let lastFullSkeleton: string | null = null

    while (consecutiveErrors < MAX_RETRY) {
      // ★ 检查 abort signal，支持用户中途停止
      const signal = this.options.getSignal?.()
      if (signal?.aborted) {
        log.info('[Phase 2] ═══ 收到 abort 信号，停止执行 ═══')
        throw new DOMException('The operation was aborted.', 'AbortError')
      }

      // 每轮重新提取骨架
      const skeleton = this.skeletonManager.getSkeleton()

      log.info(`[Phase 2] ─── 第 ${completed.length + 1} 步 ───`, {
        skeletonElements: skeleton.elements.length,
        completedCount: completed.length,
        consecutiveErrors,
      })

      // AI 生成 1 条指令（根据进入模式选择提示词）
      const isFirstEntry = completed.length === 0 && !lastError
      const coreRule = isFirstEntry ? MODE_FIRST : (lastError ? MODE_RETRY : MODE_STREAMING)
      const phase2Result = await this.callStreamingAI(text, skeleton, completed, lastError, lastFailedCommand, lastFullSkeleton, coreRule)

      // ── 无标签 → AI 无输出，任务完成 ──
      if (!phase2Result.commands?.length && !phase2Result.skill && !phase2Result.needFull) {
        log.info('[Phase 2] ═══ AI 无更多指令，任务完成 ═══')
        break
      }

      // ── command → 执行单条指令（优先于 need_full） ──
      // command + need_full 同时返回时：先执行 command（如输入手机号），
      // 成功后骨架会刷新，下一轮 AI 就能从新骨架找到目标（如"获取验证码"），
      // 不需要走 need_full 兜底。
      if (phase2Result.commands?.length) {
        const cmd = phase2Result.commands[0]
        log.info('[Phase 2] ── 执行指令 ──', {
          action: cmd.action,
          elementId: cmd.elementId,
          description: cmd.description,
          done: cmd.done,
        })

        // ★ 指令去重：和已完成的指令比较，重复则跳过执行
        const cmdKey = `${cmd.action}:${cmd.url || cmd.elementId || cmd.description || ''}`
        if (completedKeys.has(cmdKey)) {
          log.info('[Phase 2] ═══ 指令重复，跳过执行 ═══', { action: cmd.action, url: cmd.url })
          if (cmd.done === 1) {
            log.info('[Phase 2] ═══ 重复指令 done=1，停止 ═══')
            break
          }
          continue
        }

        callbacks.onCommandsParsed([cmd], completed.length + 1)

        const result = await this.executor.execute(cmd)

        log.info('[Phase 2] 指令结果', {
          action: cmd.action,
          success: result.success,
          message: result.message,
        })

        callbacks.onCommandResult(cmd.action, result.success, result.message)

        if (result.success) {
          completed.push({ action: cmd.action, elementId: cmd.elementId, description: cmd.description })
          completedKeys.add(cmdKey)
          consecutiveErrors = 0
          lastError = ''
          lastFailedCommand = null
          lastFullSkeleton = null

          // navigate 后等待页面加载
          if (cmd.action === 'navigate') {
            this.skeletonManager.invalidate()
          }

          // ★ 双重停止条件 2：AI 标记 done=1，最后一步
          if (cmd.done === 1) {
            log.info('[Phase 2] ═══ done=1，最后一步完成，停止 ═══')
            break
          }

          // command 成功 → 跳过同响应的 need_full/skill，等骨架刷新后下一轮处理
          if (phase2Result.needFull) {
            log.info('[Phase 2] → 跳过 need_full（指令执行成功，等待骨架刷新）')
          }

          // 等待页面更新（弹窗/新内容渲染），再进入下一轮提取骨架
          await sleep(500, this.options.getSignal?.())
          continue
        } else {
          lastError = `[${cmd.action}] ${result.message}`
          lastFailedCommand = { action: cmd.action, elementId: cmd.elementId, description: cmd.description, text: cmd.text, url: cmd.url }
          consecutiveErrors++
          log.warn('[Phase 2] 指令执行失败', { action: cmd.action, error: lastError })
          callbacks.onRetryMessage(`🔄 正在重试... (${consecutiveErrors}/${MAX_RETRY})`, completed.length + 1, lastFailedCommand)
          // command 失败 → 继续检查 need_full/skill
        }
      }

      // ── need_full → 提取全页骨架后重试 ──
      if (phase2Result.needFull) {
        log.info('[Phase 2] → need_full')
        const fullSkeleton = extractFullPageSkeleton()
        log.info('[Phase 2] 全页骨架提取结果', { found: !!fullSkeleton })
        lastError = '当前视口骨架未找到目标元素，已提取全页骨架'
        lastFailedCommand = null
        lastFullSkeleton = fullSkeleton
        consecutiveErrors++
        callbacks.onRetryMessage(`🔄 正在重试... (${consecutiveErrors}/${MAX_RETRY})`, completed.length + 1, lastFailedCommand)
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
        callbacks.onRetryMessage(`🔄 正在重试... (${consecutiveErrors}/${MAX_RETRY})`, completed.length + 1, lastFailedCommand)
        continue
      }
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
    lastFullSkeleton?: string | null,
    coreRule = MODE_STREAMING,
  ): Promise<import('./intent-detector').Phase2Result> {
    const settings = this.options.getSettings()
    const modelId = this.options.getModelId?.() || settings.defaultModelId
    const model = settings.models.find(m => m.id === modelId) || settings.models[0]
    if (!model) {
      log.error('[流式] 未找到可用模型')
      return { rawAiOutput: '' }
    }

    const { createAdapter } = await import('@/src/adapters')
    const adapter = createAdapter(model.provider || settings.provider)

    const skillList = this.options.getSkillList?.() || '（暂无可用技能）'
    const systemPrompt = PHASE2_SYSTEM_PROMPT
      .replace('{coreRule}', coreRule)
      .replace('{skillList}', skillList)
    const userContent = buildStreamingUserMessage(text, skeleton, completed, lastError || undefined, lastFailedCommand || undefined, lastFullSkeleton || undefined)

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
      // 请求失败时检查是否已被 abort，避免继续循环浪费请求
      if (this.options.getSignal?.()?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }
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
      hasNeedFull: !!tags.needFull,
    })

    return {
      commands: firstCommand,
      skill: tags.skill,
      needFull: tags.needFull,
      rawAiOutput: fullResponse,
    }
  }
}
