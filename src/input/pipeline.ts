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
import { extractFullPageSkeletonAsync } from '@/src/browser/local-html'
import { extractTags } from './tag-parser'
import { PHASE2_SYSTEM_PROMPT, buildPhase2Prompt, buildStreamingUserMessage, MODE_FIRST, MODE_STREAMING, MODE_RETRY, buildExtractPrompt, buildSummarizePrompt } from './prompts'
import { createAdapter } from '@/src/adapters'
import { queuedTaskStorage } from '@/src/storage'
import type { QueuedTask } from '@/src/storage'
import type { InputContext, PipelineCallbacks } from './types'
import type { AppSettings } from '@/src/types'
import type { Command, SemanticSkeleton } from '@/src/browser/types'

const log = new Logger('Pipeline')

const MAX_TOTAL_STEPS = 50

/**
 * 去掉历史消息中的重数据，保留操作上下文
 *
 * 输入格式：系统提示词\n\n[原始请求]...\n\n[页面骨架]{...}
 * 保留：[原始请求]、[已完成]、[上次错误]、[用户补充信息]
 * 过滤：系统提示词、[页面骨架] JSON、[全页骨架] JSON、[失败指令] JSON
 */
function stripHeavyData(content: string): string {
  // 1. 去掉系统提示词（[原始请求] 之前的所有内容）
  let result = content.replace(/^[\s\S]*?(?=\[原始请求\])/, '')
  // 2. [页面骨架] + JSON
  result = result.replace(/\[页面骨架\]\n\{[\s\S]*?\}(?=\n\n|$)/g, '[页面骨架] [已省略]')
  // 3. [全页骨架] + JSON
  result = result.replace(/\[全页骨架\]\n[\s\S]*?(?=\n\n|$)/g, '[全页骨架] [已省略]')
  // 4. [失败指令] + JSON（占空间但价值低）
  result = result.replace(/\[失败指令\]\n\{[\s\S]*?\}/g, '[失败指令] [已省略]')
  return result.trim()
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

// ═══════════════════════════════════════════════
// download 数据提取辅助函数
//
// 注意：download 用独立的提取逻辑，不用骨架系统。
// 骨架系统只提取可交互元素（按钮/链接/输入框），用于操作决策。
// download 需要提取所有有内容的元素（表格 td、列表 li、段落 p 等）。
// ═══════════════════════════════════════════════

/**
 * 从 DOM 提取所有有文本内容的元素（不关心是否可交互）
 * 与骨架提取的区别：骨架只提取 clickable 元素，这里提取所有有内容的元素
 */
interface DataElement {
  tag: string
  text: string
  parent?: string
  href?: string
  src?: string
  alt?: string
  row?: number
  col?: number
  type?: 'text' | 'image' | 'code'
}

function extractDataElements(): DataElement[] {
  const results: DataElement[] = []
  const seen = new Set<string>()

  // 提取所有有文本内容的元素
  const allElements = document.body.querySelectorAll('*')
  for (const el of allElements) {
    const htmlEl = el as HTMLElement
    const tag = htmlEl.tagName.toLowerCase()

    // 跳过脚本/样式/隐藏元素
    if (['script', 'style', 'noscript', 'svg', 'path', 'br', 'hr'].includes(tag)) continue
    if (htmlEl.offsetParent === null && htmlEl.style.position !== 'fixed') continue

    // 图片提取（不需要文本内容）
    if (tag === 'img') {
      const src = htmlEl.getAttribute('src')
      const alt = htmlEl.getAttribute('alt') || ''
      if (src && !src.startsWith('data:')) {
        const key = `img:${src.slice(0, 100)}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({ tag, text: alt || '[图片]', src, alt, type: 'image' })
        }
      }
      continue
    }

    // 获取直接文本内容（不包含子元素的文本）
    const directText = getDirectText(htmlEl).trim()
    if (directText.length <= 1) continue

    // 去重
    const key = `${tag}:${directText.slice(0, 50)}`
    if (seen.has(key)) continue
    seen.add(key)

    const item: DataElement = { tag, text: directText, type: 'text' }

    // 链接
    if (tag === 'a') {
      const href = htmlEl.getAttribute('href')
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        item.href = href
      }
    }

    // 代码块完整保留
    if (tag === 'pre' || tag === 'code') {
      item.text = htmlEl.textContent || directText
      item.type = 'code'
    }

    // 表格单元格保留位置信息
    if (tag === 'td' || tag === 'th') {
      const row = htmlEl.closest('tr')
      if (row && row.parentElement) {
        item.row = Array.from(row.parentElement.children).indexOf(row)
        item.col = Array.from(row.children).indexOf(htmlEl)
      }
    }

    // 父级区域
    const parent = findDataParent(htmlEl)
    if (parent) item.parent = parent

    results.push(item)
  }

  return results
}

/** 获取元素的直接文本（不包含子元素的文本） */
function getDirectText(el: HTMLElement): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    }
  }
  // 如果没有直接文本，用全部文本（处理没有子元素的情况）
  if (text.trim().length === 0) {
    text = el.textContent || ''
  }
  return text
}

/** 找到数据元素的父级区域（表格/列表/主内容区） */
function findDataParent(el: HTMLElement): string | undefined {
  let current = el.parentElement
  while (current) {
    const tag = current.tagName.toLowerCase()
    if (['table', 'thead', 'tbody', 'tr', 'ul', 'ol', 'dl', 'main', 'article', 'section'].includes(tag)) {
      return tag
    }
    current = current.parentElement
  }
  return undefined
}

/** 清洗数据元素：去掉无意义的，保留有内容的 */
function cleanDataForExtraction(elements: ReturnType<typeof extractDataElements>): string {
  const cleaned = elements
    .filter(el => {
      // 图片和代码块直接保留
      if (el.type === 'image' || el.type === 'code') return true
      // 过滤纯空白/纯标点
      const text = el.text.replace(/[\s\n.,;:!?，。；：！？]/g, '')
      return text.length > 0
    })
    .slice(0, 500)  // 限制数量，避免 token 过多

  return JSON.stringify({
    url: location.href,
    title: document.title,
    count: cleaned.length,
    data: cleaned,
  })
}

/**
 * 查找下一章/下一页链接
 *
 * 优先级：
 * 1. 文本匹配（下一章、下一页、Next、>）
 * 2. rel="next" 属性
 * 3. 常见类名（next-chapter、next-page、pagination next）
 */
function findNextChapterLink(): HTMLElement | null {
  const candidates = [
    // 文本匹配
    { selector: 'a', textPattern: /下一[章页节]|下[一]?[章页节]|Next|next|>>|›/ },
    // rel 属性
    { selector: 'a[rel="next"]' },
    // 常见类名
    { selector: '.next-chapter a, .next-page a, .pagination .next a, a.next' },
  ]

  for (const candidate of candidates) {
    const elements = document.querySelectorAll(candidate.selector)
    for (const el of elements) {
      const htmlEl = el as HTMLElement

      // 检查是否可见
      const style = window.getComputedStyle(htmlEl)
      if (style.display === 'none' || style.visibility === 'hidden') continue

      // 如果有文本模式，检查文本内容
      if (candidate.textPattern) {
        const text = htmlEl.textContent?.trim() || ''
        if (!candidate.textPattern.test(text)) continue
      }

      // 检查是否有 href（排除空链接和 javascript:void(0)）
      const href = htmlEl.getAttribute('href')
      if (!href || href === '#' || href.startsWith('javascript:')) continue

      return htmlEl
    }
  }

  return null
}

/**
 * 提取页面全文（用于 summarize）
 *
 * 与 extractDataElements 的区别：
 * - extractDataElements 返回结构化 JSON（用于 download 生成文件）
 * - extractPageText 返回纯文本（用于 summarize 发给 AI 分析）
 *
 * 提取策略：用 innerText 获取页面可见文本（保留换行和段落结构）。
 */
function extractPageText(): string {
  // innerText 自动过滤 script/style/hidden 元素，保留可见文本和换行
  const text = document.body.innerText

  return [
    `页面标题: ${document.title}`,
    `页面URL: ${location.href}`,
    '',
    '--- 页面正文 ---',
    '',
    text,
  ].join('\n').slice(0, 15000) // 限制 15000 字符，避免 token 过多
}

export interface PipelineOptions {
  getSettings: () => AppSettings
  /** 获取当前使用的模型 ID（优先会话级，回退全局默认） */
  getModelId?: () => string
  getRecentMessages?: () => Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
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

    // 2. /command 指令 → 跳过 Phase 1，直接进 Phase 2
    if (routeResult.type === 'capability') {
      log.info('[路由] → 能力域指令，跳过 Phase 1', { command: routeResult.command, args: routeResult.args })
      const commandText = routeResult.args
        ? `${routeResult.command} ${routeResult.args}`
        : routeResult.command
      callbacks.onChatStart()
      callbacks.onActionDetected()
      await this.processPhase2WithRetry(commandText, callbacks)
      return
    }

    // 3. Phase 1 — 流式输出，但检测到操作标签时清掉内容，用户只看到"思考中"
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

    // Phase 1 → Phase 2 之间检查 abort
    if (this.options.getSignal?.()?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
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
      const result = await this.executor.execute(cmd, this.options.getSignal?.())
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
    log.info('[Phase 2] ─── 流式执行模式 ───', { resumedSteps: initialCompleted?.length || 0 })

    const completed: Array<{ action: string; elementId?: string; description?: string }> = initialCompleted ? [...initialCompleted] : []
    const completedKeys = new Set<string>(completed.map(c => `${c.action}:${c.description || ''}`))  // 指令去重 key 集合
    let lastError = ''
    let lastFailedCommand: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null = null
    let lastFullSkeleton: string | null = null
    let userInputContext: string | undefined = undefined
    let totalExecutions = 0  // 总执行次数（成功+失败+重试），防止无限循环

    while (totalExecutions < MAX_TOTAL_STEPS) {
      // ★ 检查 abort signal，支持用户中途停止
      const signal = this.options.getSignal?.()
      if (signal?.aborted) {
        log.info('[Phase 2] ═══ 收到 abort 信号，停止执行 ═══')
        throw new DOMException('The operation was aborted.', 'AbortError')
      }

      // 每轮重新提取骨架（含跨域 iframe 内元素）
      const skeleton = await this.skeletonManager.getSkeletonWithIframes()

      // 骨架提取后检查 abort
      if (this.options.getSignal?.()?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }

      log.info(`[Phase 2] ─── 第 ${completed.length + 1} 步 ───`, {
        skeletonElements: skeleton.elements.length,
        completedCount: completed.length,
      })

      // AI 生成 1 条指令（根据进入模式选择提示词）
      const isFirstEntry = completed.length === 0 && !lastError
      const coreRule = isFirstEntry ? MODE_FIRST : (lastError ? MODE_RETRY : MODE_STREAMING)
      const phase2Result = await this.callStreamingAI(text, skeleton, completed, lastError, lastFailedCommand, lastFullSkeleton, coreRule, userInputContext)

      // AI 请求返回后再次检查 abort
      if (this.options.getSignal?.()?.aborted) {
        log.info('[Phase 2] ═══ AI 请求后收到 abort 信号 ═══')
        throw new DOMException('The operation was aborted.', 'AbortError')
      }

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
          continue
        } catch (err) {
          // 用户取消（abort）
          log.info('[Phase 2] ═══ need_input 被取消 ═══')
          throw err
        }
      }

      // ── command → 执行指令（支持单条 + 批量数组） ──
      // command + need_full 同时返回时：先执行 command（如输入手机号），
      // 成功后骨架会刷新，下一轮 AI 就能从新骨架找到目标（如"获取验证码"），
      // 不需要走 need_full 兜底。
      if (phase2Result.commands?.length) {
        const cmds = phase2Result.commands
        const isBatch = cmds.length > 1
        if (isBatch) {
          log.info(`[Phase 2] ── 批量执行 ${cmds.length} 条指令 ──`)
        }

        // 通知 UI（批量时只显示第一条，后续由 onCommandResult 逐条展示）
        callbacks.onCommandsParsed([cmds[0]], completed.length + 1)

        let batchStopped = false  // 批量中是否有命令触发了 break（navigate/blank/done:1）

        for (const cmd of cmds) {
          if (batchStopped) break

          log.info('[Phase 2] ── 执行指令 ──', {
            action: cmd.action,
            elementId: cmd.elementId,
            description: cmd.description,
            done: cmd.done,
          })

          // ★ 指令去重
          const cmdKey = `${cmd.action}:${cmd.url || cmd.elementId || cmd.description || ''}:${cmd.text || ''}`
          if (completedKeys.has(cmdKey)) {
            totalExecutions++
            log.info('[Phase 2] ═══ 指令重复，跳过执行 ═══', { action: cmd.action, url: cmd.url })
            continue
          }

          // ★ download → 提取页面数据，生成文件
          // done:0 = 生成文件后继续请求 AI（批量导出场景）
          // done:1 = 生成文件后结束
          if (cmd.action === 'download') {
            log.info('[Phase 2] ── download：提取页面数据 ──', { done: cmd.done })
            const dataElements = extractDataElements()
            if (dataElements.length === 0) {
              callbacks.onCommandResult('download', false, '页面无可提取数据')
              lastError = '页面无可提取数据'
            } else {
              try {
                log.info('[Phase 2] download 提取到元素', { count: dataElements.length })
                const cleaned = cleanDataForExtraction(dataElements)
                const automationEnabled = this.options.getSettings().automationEnabled !== false
                const extractPrompt = buildExtractPrompt(text, cleaned, automationEnabled)
                const aiResult = await this.callAIForExtraction(extractPrompt)
                callbacks.onFileOutput?.(aiResult)
                completed.push({ action: cmd.action, description: cmd.description })
                completedKeys.add(cmdKey)
                callbacks.onCommandResult('download', true, '数据提取完成')
                log.info('[Phase 2] ═══ download 完成 ═══')

                // done:0 → 自动点击下一章，继续请求 AI
                if (cmd.done !== 1) {
                  const nextLink = findNextChapterLink()
                  if (nextLink) {
                    log.info('[Phase 2] download 自动点击下一章', { href: (nextLink as HTMLAnchorElement).href, text: nextLink.textContent?.trim() })
                    nextLink.click()
                    await sleep(2000, this.options.getSignal?.())
                    this.skeletonManager.invalidate()
                  }
                }
              } catch (err) {
                // 中止请求直接抛出，不当作执行失败
                if (err instanceof DOMException && err.name === 'AbortError') throw err
                const errMsg = err instanceof Error ? err.message : String(err)
                callbacks.onCommandResult('download', false, errMsg)
                lastError = `[download] ${errMsg}`
                log.error('[Phase 2] download 失败', err)
              }
            }
            totalExecutions++
            if (cmd.done === 1) {
              log.info('[Phase 2] ═══ done=1，任务完成 ═══')
              batchStopped = true
              break
            }
            continue
          }

          // ★ summarize → 提取页面全文，调 AI 分析总结，输出聊天消息
          if (cmd.action === 'summarize') {
            log.info('[Phase 2] ── summarize：提取页面全文 ──')
            const pageText = extractPageText()
            if (pageText.length < 50) {
              callbacks.onCommandResult('summarize', false, '页面内容过少')
              lastError = '页面内容过少'
            } else {
              try {
                log.info('[Phase 2] summarize 提取到文本', { length: pageText.length })
                const summarizePrompt = buildSummarizePrompt(text, pageText)
                const aiResult = await this.callAIForSummarize(summarizePrompt)
                log.info('[Phase 2] summarize AI 返回', { length: aiResult.length, preview: aiResult.slice(0, 100) })
                // 创建新消息并输出总结
                callbacks.onChatStart()
                callbacks.onChatDelta(aiResult)
                log.info('[Phase 2] summarize onChatDelta 已调用', { contentLength: aiResult.length })
                callbacks.onChatEnd()
                completed.push({ action: cmd.action, description: cmd.description })
                completedKeys.add(cmdKey)
                callbacks.onCommandResult('summarize', true, '分析完成')
                log.info('[Phase 2] ═══ summarize 完成 ═══')
              } catch (err) {
                // 中止请求直接抛出，不当作执行失败
                if (err instanceof DOMException && err.name === 'AbortError') throw err
                const errMsg = err instanceof Error ? err.message : String(err)
                callbacks.onCommandResult('summarize', false, errMsg)
                lastError = `[summarize] ${errMsg}`
                log.error('[Phase 2] summarize 失败', err)
              }
            }
            totalExecutions++
            if (cmd.done === 1) {
              log.info('[Phase 2] ═══ done=1，任务完成 ═══')
              batchStopped = true
              break
            }
            continue
          }

          // ★ click + done:0 → 先存 queued task，再执行 click
          const pendingTask: QueuedTask | null = (cmd.action === 'click' && cmd.done !== 1)
            ? {
                originalRequest: text,
                completedSteps: [...completed, { action: cmd.action, elementId: cmd.elementId, description: cmd.description }],
                recentMessages: this.options.getRecentMessages?.()?.map(m => ({ role: m.role, content: m.content })),
                timestamp: Date.now(),
              }
            : null
          if (pendingTask) {
            await queuedTaskStorage.setValue(pendingTask)
            log.info('[Phase 2] ── click 前置保存 queued task ──')
          }

          // ★ upload 补充文件名：AI 可能不传 filename，从用户输入的 [文件: xxx] 标签提取
          if (cmd.action === 'upload' && !cmd.filename) {
            const fileTagMatch = text.match(/\[文件:\s*(.+?)\]/)
            if (fileTagMatch) cmd.filename = fileTagMatch[1].trim()
          }

          const result = await this.executor.execute(cmd, this.options.getSignal?.())
          totalExecutions++

          // 延迟清除 queued task
          if (pendingTask && !result.openedNewTab) {
            setTimeout(() => {
              queuedTaskStorage.setValue(null).catch(() => {})
              log.info('[Phase 2] ── click 未跳转，清除 queued task ──')
            }, 500)
          } else if (pendingTask && result.openedNewTab) {
            log.info('[Phase 2] ── _blank 新开页，保留 queued task 给新标签页 ──')
            completed.push({ action: cmd.action, elementId: cmd.elementId, description: cmd.description })
            log.info('[Phase 2] ═══ _blank 新开页，原标签页停止，等待新页续接 ═══')
            batchStopped = true
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
            lastError = ''
            lastFailedCommand = null
            lastFullSkeleton = null

            // navigate 后等待页面加载
            if (cmd.action === 'navigate') {
              this.skeletonManager.invalidate()
              const task: QueuedTask = {
                originalRequest: text,
                completedSteps: completed.map(c => ({ action: c.action, elementId: c.elementId, description: c.description })),
                recentMessages: this.options.getRecentMessages?.()?.map(m => ({ role: m.role, content: m.content })),
                timestamp: Date.now(),
              }
              await queuedTaskStorage.setValue(task)
              log.info('[Phase 2] ═══ navigate 成功，任务已保存到 storage ═══', { originalRequest: text, completedSteps: completed.length })
              batchStopped = true
              break
            }

            // ★ done:1 → 最后一步执行成功，直接结束
            if (cmd.done === 1) {
              log.info('[Phase 2] ═══ done=1，任务完成 ═══')
              batchStopped = true
              break
            }

            // 等待页面更新
            if (this.options.getSignal?.()?.aborted) {
              log.info('[Phase 2] ═══ 指令执行后收到 abort 信号 ═══')
              throw new DOMException('The operation was aborted.', 'AbortError')
            }

            // 批量执行时缩短等待时间（同页面操作不需要等太久）
            await sleep(isBatch ? 200 : 500, this.options.getSignal?.())
          } else {
            // 失败 → 记录错误，批量时跳过继续，单条时走重试
            lastError = `[${cmd.action}] ${result.message}`
            lastFailedCommand = { action: cmd.action, elementId: cmd.elementId, description: cmd.description, text: cmd.text, url: cmd.url }
            log.warn('[Phase 2] 指令执行失败', { action: cmd.action, error: lastError })
            if (!isBatch) {
              callbacks.onRetryMessage(`🔄 正在重试... (${totalExecutions}/${MAX_TOTAL_STEPS})`, completed.length + 1, lastFailedCommand)
            }
            // 批量时跳过继续，单条时走 need_full 兜底
          }
        }

        // 批量执行完成，记录汇总
        if (isBatch && !batchStopped) {
          log.info(`[Phase 2] ═══ 批量执行完成 ═══`, { total: cmds.length, completed: completed.length })
        }

        // navigate/blank/done:1 触发了内层 break，外层循环也要停止
        if (batchStopped) break
      }

      // ── need_full → 提取全页骨架后重试 ──
      if (phase2Result.needFull) {
        totalExecutions++  // need_full 也计数
        log.info('[Phase 2] → need_full')
        const fullSkeleton = await extractFullPageSkeletonAsync()
        log.info('[Phase 2] 全页骨架提取结果', { found: !!fullSkeleton })
        lastError = '当前视口骨架未找到目标元素，已提取全页骨架'
        lastFailedCommand = null
        lastFullSkeleton = fullSkeleton
        callbacks.onRetryMessage(`🔄 正在重试... (${totalExecutions}/${MAX_TOTAL_STEPS})`, completed.length + 1, lastFailedCommand)
        continue
      }
    }

    if (totalExecutions >= MAX_TOTAL_STEPS) {
      log.error(`[Phase 2] ═══ 达到最大执行次数 ${MAX_TOTAL_STEPS}，停止 ═══`)
      callbacks.onError('操作步骤过多，已停止')
    } else if (completed.length > 0) {
      log.info('[Phase 2] ═══ 流式执行完成 ═══', { totalSteps: completed.length })
      callbacks.onAllCommandsDone?.(text, completed.map(c => ({ action: c.action, elementId: c.elementId, description: c.description })))
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
  // 数据提取 AI 调用（download 专用）
  // ═══════════════════════════════════════════════

  private async callAIForExtraction(prompt: string): Promise<string> {
    const settings = this.options.getSettings()
    const modelId = this.options.getModelId?.() || settings.defaultModelId
    const model = settings.models.find(m => m.id === modelId) || settings.models[0]
    if (!model) throw new Error('未找到可用模型')

    const adapter = createAdapter(model.provider || settings.provider)
    const messages = [{ role: 'user' as const, content: prompt }]
    let fullResponse = ''

    await adapter.chat(
      {
        baseUrl: model.baseUrl || settings.baseUrl,
        apiKey: model.apiKey || settings.apiKey,
        modelName: model.modelName || settings.defaultModelId,
        messages,
        signal: this.options.getSignal?.(),
      },
      (chunk) => { if (chunk.delta) fullResponse += chunk.delta }
    )

    return fullResponse
  }

  // ═══════════════════════════════════════════════
  // 页面分析 AI 调用（summarize 专用）
  // ═══════════════════════════════════════════════

  private async callAIForSummarize(prompt: string): Promise<string> {
    const settings = this.options.getSettings()
    const modelId = this.options.getModelId?.() || settings.defaultModelId
    const model = settings.models.find(m => m.id === modelId) || settings.models[0]
    if (!model) throw new Error('未找到可用模型')

    const adapter = createAdapter(model.provider || settings.provider)
    const messages = [{ role: 'user' as const, content: prompt }]
    let fullResponse = ''

    await adapter.chat(
      {
        baseUrl: model.baseUrl || settings.baseUrl,
        apiKey: model.apiKey || settings.apiKey,
        modelName: model.modelName || settings.defaultModelId,
        messages,
        signal: this.options.getSignal?.(),
      },
      (chunk) => { if (chunk.delta) fullResponse += chunk.delta }
    )

    return fullResponse
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
    // 请求前检查 abort
    if (this.options.getSignal?.()?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    const settings = this.options.getSettings()
    const modelId = this.options.getModelId?.() || settings.defaultModelId
    const model = settings.models.find(m => m.id === modelId) || settings.models[0]
    if (!model) {
      log.error('[流式] 未找到可用模型')
      return { rawAiOutput: '' }
    }

    const { createAdapter } = await import('@/src/adapters')
    const adapter = createAdapter(model.provider || settings.provider)

    const systemPrompt = buildPhase2Prompt(settings.automationEnabled !== false)
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
    // 跳过最后一条 user 消息（已在下方 [原始请求] 中嵌入，避免重复）
    const lastUserIdx = recentMsgs.findLastIndex(m => m.role === 'user')
    let validMsgCount = 0
    for (let i = 0; i < recentMsgs.length; i++) {
      if (i === lastUserIdx) continue
      const msg = recentMsgs[i]
      if (msg.content && msg.content.trim()) {
        const cleaned = stripHeavyData(msg.content)
        messages.push({ id: Date.now().toString(), role: msg.role, content: cleaned, timestamp: Date.now() })
        validMsgCount++
      }
    }
    messages.push({ id: Date.now().toString(), role: 'user', content: `${systemPrompt}\n\n${userContent}`, timestamp: Date.now() })
    log.info(`[流式] 历史消息 ${validMsgCount} 条`)

    let fullResponse = ''
    let reasoningResponse = ''
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
          if (chunk.reasoningDelta) reasoningResponse += chunk.reasoningDelta
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

    log.info('[流式] 标签提取', {
      hasCommand: !!tags.commands?.length,
      commandCount: tags.commands?.length || 0,
      action: tags.commands?.[0]?.action,
      elementId: tags.commands?.[0]?.elementId,
      description: tags.commands?.[0]?.description,
      done: tags.commands?.[0]?.done,
      hasNeedFull: !!tags.needFull,
      hasNeedInput: !!tags.needInput,
    })

    return {
      commands: tags.commands,
      needFull: tags.needFull,
      needInput: tags.needInput,
      rawAiOutput: fullResponse,
    }
  }
}
