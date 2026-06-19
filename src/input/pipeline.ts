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
import { queuedTaskStorage } from '@/src/storage'
import type { QueuedTask } from '@/src/storage'
import type { InputContext, PipelineCallbacks } from './types'
import type { AppSettings } from '@/src/types'
import type { Command, SemanticSkeleton } from '@/src/browser/types'

const log = new Logger('Pipeline')

const MAX_RETRY = 5
const MAX_TOTAL_STEPS = 20

/**
 * 去掉历史消息中的重数据（骨架 JSON 等），减少 token 消耗
 */
function stripHeavyData(content: string): string {
  let result = content
  result = result.replace(/页面骨架:\n[\s\S]*?(?=\n\n|$)/g, '页面骨架: [已省略]')
  result = result.replace(/\[(全页|当前页面)骨架\]\n[\s\S]*?(?=\n\n|$)/g, '[$1骨架]: [已省略]')
  return result
}

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
  getRecentMessages?: () => Array<{ role: 'user' | 'assistant'; content: string }>
  getSignal?: () => AbortSignal | undefined
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
          if (/\[(?:action|command)|(?:action|command)\]/.test(phase1StreamedContent)) {
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

    // ★ Phase 1 快速通道：直接输出了 [command]，跳过 Phase 2
    if (p1.commands?.length) {
      log.info('[流程] Phase 1 → [command] 快速通道 → 直接执行', {
        actions: p1.commands.map(c => c.action),
      })
      callbacks.onActionDetected()
      await this.executePhase1Commands(p1.commands, ctx.text, callbacks)
      return
    }

    // 3. Phase 2 — 移除"思考中"消息，只展示解析后的执行结果
    log.info('[流程] Phase 1 → [action] → 进入 Phase 2')
    callbacks.onActionDetected()
    await this.processPhase2WithRetry(ctx.text, callbacks)
  }

  // ═══════════════════════════════════════════════
  // Phase 1 快速通道 — 直接执行无骨架指令
  // ═══════════════════════════════════════════════

  /**
   * 执行 Phase 1 直出的指令（快速通道）
   *
   * 这些指令不需要页面骨架，由 Phase 1 AI 直接生成。
   * 逐条执行，和 Phase 2 共用相同的执行逻辑和 UI 回调。
   */
  private async executePhase1Commands(
    commands: Command[],
    userText: string,
    callbacks: PipelineCallbacks,
  ): Promise<void> {
    log.info('[Phase 1 快速通道] ─── 开始执行 ───', { count: commands.length })

    const completed: Command[] = []

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]
      log.info(`[Phase 1 快速通道] ── 第 ${i + 1}/${commands.length} 条 ──`, {
        action: cmd.action,
        url: cmd.url,
        direction: cmd.direction,
        key: cmd.key,
      })

      callbacks.onCommandsParsed([cmd], i + 1)
      const result = await this.executor.execute(cmd)
      callbacks.onCommandResult(cmd.action, result.success, result.message)

      if (result.success) {
        completed.push(cmd)
        if (cmd.action === 'navigate') {
          this.skeletonManager.invalidate()
        }
      } else {
        log.warn('[Phase 1 快速通道] 指令执行失败', { action: cmd.action, message: result.message })
      }
    }

    if (completed.length > 0) {
      log.info('[Phase 1 快速通道] ═══ 执行完成 ═══', {
        total: commands.length,
        success: completed.length,
      })
      callbacks.onAllCommandsDone?.(userText, completed)
    }
  }

  // ═══════════════════════════════════════════════
  // Phase 2 — 流式执行（每次 1 条指令）
  // ═══════════════════════════════════════════════

  private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks, initialCompleted?: Array<{ action: string; elementId?: string; description?: string }>): Promise<void> {
    log.info('[Phase 2] ─── 流式执行模式 ───', { maxRetry: MAX_RETRY, resumedSteps: initialCompleted?.length || 0 })

    const completed: Array<{ action: string; elementId?: string; description?: string }> = initialCompleted ? [...initialCompleted] : []
    const completedKeys = new Set<string>(completed.map(c => `${c.action}:${c.description || ''}`))  // 指令去重 key 集合
    let consecutiveErrors = 0
    let lastError = ''
    let lastFailedCommand: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null = null
    let lastFullSkeleton: string | null = null
    let userInputContext: string | undefined = undefined

    while (consecutiveErrors < MAX_RETRY && completed.length < MAX_TOTAL_STEPS) {
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
      const phase2Result = await this.callStreamingAI(text, skeleton, completed, lastError, lastFailedCommand, lastFullSkeleton, coreRule, userInputContext)

      // ── 无标签 → AI 无输出，任务完成 ──
      if (!phase2Result.commands?.length && !phase2Result.needFull && !phase2Result.needInput) {
        log.info('[Phase 2] ═══ AI 无更多指令，任务完成 ═══')
        break
      }

      // ── need_input → 暂停，等待用户输入 ──
      if (phase2Result.needInput) {
        log.info('[Phase 2] → need_input', { message: phase2Result.needInput.message })
        try {
          userInputContext = await callbacks.onNeedInput(phase2Result.needInput.message)
          log.info('[Phase 2] ← 用户已提供输入，继续执行')
          // 清除错误状态，用新上下文重试
          lastError = ''
          lastFailedCommand = null
          consecutiveErrors = 0
          continue
        } catch (err) {
          // 用户取消（abort）
          log.info('[Phase 2] ═══ need_input 被取消 ═══')
          throw err
        }
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

        // ★ click + done:0 → 先存 queued task，再执行 click
        // 页面跳转 → JS 上下文销毁 → setTimeout callback 不执行 → queued task 留在 storage
        // 页面没跳 → setTimeout 触发 → 删掉 queued task → 继续执行
        const pendingTask: QueuedTask | null = (cmd.action === 'click' && cmd.done !== 1)
          ? {
              originalRequest: text,
              completedSteps: [...completed, { action: cmd.action, elementId: cmd.elementId, description: cmd.description }],
              timestamp: Date.now(),
            }
          : null
        if (pendingTask) {
          await queuedTaskStorage.setValue(pendingTask)
          log.info('[Phase 2] ── click 前置保存 queued task ──')
        }

        const result = await this.executor.execute(cmd)

        // 延迟清除：页面跳了 → JS 销毁 → callback 不执行 → queued task 保留
        // _blank 新开页 → 原页不销毁 → 跳过清除，让新页读到任务
        if (pendingTask && !result.openedNewTab) {
          setTimeout(() => {
            queuedTaskStorage.setValue(null).catch(() => {})
            log.info('[Phase 2] ── click 未跳转，清除 queued task ──')
          }, 500)
        } else if (pendingTask && result.openedNewTab) {
          log.info('[Phase 2] ── _blank 新开页，保留 queued task 给新标签页 ──')
          // 原标签页停止执行，由新标签页续接剩余步骤
          completed.push({ action: cmd.action, elementId: cmd.elementId, description: cmd.description })
          log.info('[Phase 2] ═══ _blank 新开页，原标签页停止，等待新页续接 ═══')
          break
        }

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

            // done:1 → 单步 navigate 任务已完成，无需保存
            if (cmd.done === 1) {
              log.info('[Phase 2] ═══ navigate done=1，任务完成 ═══')
              break
            }

            // ★ 跨标签页续接：保存剩余任务到 storage，新页加载后自动恢复
            const task: QueuedTask = {
              originalRequest: text,
              completedSteps: completed.map(c => ({ action: c.action, elementId: c.elementId, description: c.description })),
              timestamp: Date.now(),
            }
            await queuedTaskStorage.setValue(task)
            log.info('[Phase 2] ═══ navigate 成功，任务已保存到 storage ═══', { originalRequest: text, completedSteps: completed.length })
            break
          }

          // ★ done:1，最后一步完成
          if (cmd.done === 1) {
            log.info('[Phase 2] ═══ done=1，最后一步完成，停止 ═══')
            break
          }

          // command 成功 → 跳过同响应的 need_full，等骨架刷新后下一轮处理
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
          // command 失败 → 继续检查 need_full
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
    }

    if (consecutiveErrors >= MAX_RETRY) {
      log.error(`[Phase 2] ═══ 连续 ${MAX_RETRY} 次失败，放弃 ═══`)
      callbacks.onError('未找到对应元素，请准确说出您的需求')
    } else if (completed.length >= MAX_TOTAL_STEPS) {
      log.warn(`[Phase 2] ═══ 达到最大步数 ${MAX_TOTAL_STEPS}，停止 ═══`)
      callbacks.onAllCommandsDone?.(text, completed.map(c => ({ action: c.action, elementId: c.elementId })))
    } else if (completed.length > 0) {
      log.info('[Phase 2] ═══ 流式执行完成 ═══', { totalSteps: completed.length })
      callbacks.onAllCommandsDone?.(text, completed.map(c => ({ action: c.action, elementId: c.elementId })))
    }
  }

  // ═══════════════════════════════════════════════
  // 跨标签页续接 — navigate 新开页后自动恢复
  // ═══════════════════════════════════════════════

  /**
   * 恢复排队任务（新标签页加载完成后调用）
   *
   * 跳过 Phase 1，直接进入 Phase 2 流式执行。
   * 已完成的步骤从 storage 读取，传入 processPhase2WithRetry。
   */
  async resumeQueuedTask(task: QueuedTask, callbacks: PipelineCallbacks): Promise<void> {
    log.info('╔══════════════════════════════════════╗')
    log.info('║       恢复排队任务                    ║')
    log.info('╚══════════════════════════════════════╝', {
      originalRequest: task.originalRequest,
      completedSteps: task.completedSteps.length,
    })

    callbacks.onActionDetected()

    // 将已完成步骤转为 processPhase2WithRetry 的格式
    const completed = task.completedSteps.map(c => ({
      action: c.action,
      elementId: c.elementId,
      description: c.description,
    }))

    // 直接进入 Phase 2 流式执行，跳过 Phase 1
    await this.processPhase2WithRetry(task.originalRequest, callbacks, completed)
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
    userInputContext?: string,
  ): Promise<import('./intent-detector').Phase2Result & { needInput?: { message: string } }> {
    const settings = this.options.getSettings()
    const modelId = this.options.getModelId?.() || settings.defaultModelId
    const model = settings.models.find(m => m.id === modelId) || settings.models[0]
    if (!model) {
      log.error('[流式] 未找到可用模型')
      return { rawAiOutput: '' }
    }

    const { createAdapter } = await import('@/src/adapters')
    const adapter = createAdapter(model.provider || settings.provider)

    const systemPrompt = PHASE2_SYSTEM_PROMPT
      .replace('{coreRule}', coreRule)
    const userContent = buildStreamingUserMessage(text, skeleton, completed, lastError || undefined, lastFailedCommand || undefined, lastFullSkeleton || undefined, userInputContext)

    log.info('[流式] ═══ AI 请求 ═══', {
      skeletonElements: skeleton.elements.length,
      completedCount: completed.length,
      hasError: !!lastError,
    })

    // 构建消息列表：历史上下文 + 当前用户消息（与 callAI 一致）
    const messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }> = []
    const recentMsgs = this.options.getRecentMessages?.() || []
    let validMsgCount = 0
    for (const msg of recentMsgs) {
      if (msg.content && msg.content.trim()) {
        const cleaned = stripHeavyData(msg.content)
        messages.push({ id: Date.now().toString(), role: msg.role, content: cleaned, timestamp: Date.now() })
        validMsgCount++
      }
    }
    messages.push({ id: Date.now().toString(), role: 'user', content: `${systemPrompt}\n\n${userContent}`, timestamp: Date.now() })
    log.info(`[流式] 历史消息 ${validMsgCount} 条`)

    let fullResponse = ''
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
      hasNeedFull: !!tags.needFull,
      hasNeedInput: !!tags.needInput,
    })

    return {
      commands: firstCommand,
      needFull: tags.needFull,
      needInput: tags.needInput,
      rawAiOutput: fullResponse,
    }
  }
}
