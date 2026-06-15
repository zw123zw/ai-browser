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
import { PHASE2_RETRY_SYSTEM_PROMPT, buildRetryUserMessage } from './prompts'
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
  // Phase 2 + 统一重试循环
  // ═══════════════════════════════════════════════

  private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks): Promise<void> {
    log.info('[Phase 2] ─── 操作决策 + 统一重试循环 ───', { maxRetry: MAX_RETRY })

    let lastError = ''
    let htmlFragments: string | null = null
    let completed: Array<{ action: string; elementId?: string }> = []
    let completedKeys = new Set<string>()

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      const skeleton = this.skeletonManager.getSkeleton()

      log.info(`[Phase 2] ─── 第 ${attempt === 0 ? '首次' : `重试 ${attempt}/${MAX_RETRY}`} ───`, {
        skeletonUrl: skeleton.url,
        skeletonElements: skeleton.elements.length,
        completedCount: completed.length,
      })

      // ── 首次 vs 重试 ──
      let phase2Result
      if (attempt === 0) {
        phase2Result = await this.detector.detectPhase2(text, skeleton)
      } else {
        callbacks.onRetryMessage(`⚠️ 操作失败，重试 ${attempt}/${MAX_RETRY}...`)
        phase2Result = await this.retryPhase2(text, skeleton, lastError, htmlFragments, completed)
      }

      // ── [command] + [need_html] 共存时：先执行 command，need_html 留给下轮 ──
      // ── 纯 [need_html]（无 command）→ 搜 HTML 片段，当错误处理 ──
      if (phase2Result.needHtml && !phase2Result.commands?.length) {
        log.info('[Phase 2] → need_html（无 command）', {
          keywords: phase2Result.needHtml.keywords,
          reason: phase2Result.needHtml.reason,
        })
        if (!htmlFragments) {
          htmlFragments = searchByKeywords(phase2Result.needHtml.keywords)
          log.info('[Phase 2] 关键词搜索结果', {
            found: !!htmlFragments,
            length: htmlFragments?.length || 0,
          })
        }
        lastError = `未找到 "${phase2Result.needHtml.description}" 对应元素`
        continue
      }

      // 有 command + need_html 共存 → 先执行 command，执行完再搜 HTML
      let pendingNeedHtml = phase2Result.needHtml && phase2Result.commands?.length
        ? phase2Result.needHtml
        : null

      if (pendingNeedHtml) {
        log.info('[Phase 2] → command + need_html 共存，先执行 command', {
          needHtmlKeywords: pendingNeedHtml.keywords,
          commandCount: phase2Result.commands!.length,
        })
      }

      // ── [command] → 兜底 key 匹配，跳过已完成，执行剩余 ──
      if (phase2Result.commands?.length) {
        log.info('[Phase 2] → 指令执行', {
          count: phase2Result.commands.length,
          completedCount: completed.length,
        })
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

        // 兜底 key 匹配：检查新指令是否能对上已完成的
        const newKeys = phase2Result.commands.map(getCommandKey)
        const matchedAny = newKeys.some(k => completedKeys.has(k))

        // 所有新指令的 key 都匹配不到 → 整个指令流重新执行
        const toExecute = matchedAny
          ? phase2Result.commands.filter(cmd => !completedKeys.has(getCommandKey(cmd)))
          : phase2Result.commands

        log.info('[Phase 2] 待执行指令', {
          total: phase2Result.commands.length,
          toExecute: toExecute.length,
          skipped: phase2Result.commands.length - toExecute.length,
          matchedAny,
        })

        let allSuccess = true
        for (const cmd of toExecute) {
          log.info('[Phase 2] ── 执行指令 ──', {
            action: cmd.action,
            elementId: cmd.elementId,
            description: cmd.description,
          })

          const result = await this.executor.execute(cmd)

          log.info('[Phase 2] 指令结果', {
            action: cmd.action,
            success: result.success,
            message: result.message,
          })

          callbacks.onCommandResult(cmd.action, result.success, result.message)

          if (result.success) {
            const key = getCommandKey(cmd)
            completedKeys.add(key)
            completed.push({ action: cmd.action, elementId: cmd.elementId })

            if (cmd.action === 'navigate') {
              log.info('[Phase 2] navigate 成功，标记骨架失效')
              this.skeletonManager.invalidate()
            }
          } else {
            lastError = `[${cmd.action}] ${result.message}`
            allSuccess = false
            log.warn('[Phase 2] 指令执行失败', { action: cmd.action, error: lastError })
            break
          }
        }

        if (allSuccess) {
          if (pendingNeedHtml) {
            // command 执行成功，页面已变，现在搜 HTML 片段
            log.info('[Phase 2] command 成功，页面已变，搜索 need_html 片段', {
              keywords: pendingNeedHtml.keywords,
            })
            htmlFragments = searchByKeywords(pendingNeedHtml.keywords)
            lastError = `未找到 "${pendingNeedHtml.description}" 对应元素`
            log.info('[Phase 2] need_html 搜索结果', {
              found: !!htmlFragments,
              length: htmlFragments?.length || 0,
            })
            continue
          }
          log.info('[Phase 2] ═══ 全部指令执行成功 ═══')
          callbacks.onAllCommandsDone?.(text, phase2Result.commands)
          return
        }

        continue
      }

      // ── [skill] → 执行 ──
      if (phase2Result.skill) {
        const { name, userText } = phase2Result.skill
        log.info('[Phase 2] → 技能触发', { name, userText })
        callbacks.onSkillParsed(name, userText)

        try {
          const result = await this.options.onSkillActivate?.(name, userText)
          log.info('[Phase 2] 技能执行结果', { name, success: result?.success, message: result?.message })
          if (result && result.success) {
            completedKeys.add(getCommandKey({ action: 'skill', elementId: name }))
            completed.push({ action: 'skill', elementId: name })
            log.info('[Phase 2] ═══ 技能执行成功 ═══')
            return
          }
          lastError = result?.message || `技能 "${name}" 执行失败`
        } catch (error) {
          lastError = `技能异常: ${error instanceof Error ? error.message : String(error)}`
          log.error('[Phase 2] 技能执行异常', error)
        }
        continue
      }

      // ── 无标签 ──
      lastError = '未找到有效指令标签'
      log.warn('[Phase 2] 未提取到有效标签', { attempt: attempt + 1 })
      continue
    }

    log.error(`[Phase 2] ═══ 超过 ${MAX_RETRY} 次重试上限，放弃 ═══`)
    callbacks.onError('未找到对应元素，请准确说出您的需求')
  }

  // ═══════════════════════════════════════════════
  // 重试 AI 请求
  // ═══════════════════════════════════════════════

  private async retryPhase2(
    text: string,
    skeleton: SemanticSkeleton,
    lastError: string,
    htmlFragments: string | null,
    completed: Array<{ action: string; elementId?: string }>,
  ): Promise<import('./intent-detector').Phase2Result> {
    const settings = this.options.getSettings()
    const model = settings.models.find(m => m.id === settings.defaultModelId) || settings.models[0]
    if (!model) {
      log.error('[重试] 未找到可用模型')
      return { rawAiOutput: '' }
    }

    const { createAdapter } = await import('@/src/adapters')
    const adapter = createAdapter(model.provider || settings.provider)

    const userContent = buildRetryUserMessage(text, skeleton, lastError, htmlFragments, completed)

    log.info('[重试] ═══ 重试 AI 请求 ═══', {
      skeletonUrl: skeleton.url,
      skeletonElements: skeleton.elements.length,
      completedCount: completed.length,
      hasHtmlFragments: !!htmlFragments,
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
            { id: Date.now().toString(), role: 'user', content: `${PHASE2_RETRY_SYSTEM_PROMPT}\n\n${userContent}`, timestamp: Date.now() },
          ],
          signal: this.options.getSignal?.(),
        },
        (chunk) => {
          if (chunk.delta) fullResponse += chunk.delta
        },
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
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
