/**
 * 翻译服务
 *
 * 统一管理划词翻译和自动翻译的 AI 调用逻辑。
 * 绕过 Phase1/Phase2 pipeline，直接调用 adapter。
 *
 * 职责：
 * - 划词翻译：单条文本翻译，返回译文
 * - 自动翻译：批量翻译可视窗口元素，直接替换 DOM
 * - 增量翻译：滚动后翻译新进入可视窗口的元素
 */

import { Logger } from '@/src/utils/logger'
import { createAdapter } from '@/src/adapters'
import { filterCodeText, restorePlaceholders, isCodeElement } from './code-filter'
import { parseTranslateResponse, parseSingleTranslation } from './translate-parser'
import {
  TRANSLATE_SYSTEM_PROMPT,
  buildSelectionTranslateMessage,
  buildAutoTranslateMessage,
} from '@/src/input/prompts'
import { ensureAllSkeletonIds, ensureSkeletonId } from './skeleton-id'
import type { AppSettings, ChatMessage, StreamChunk } from '@/src/types'
import { v4 as uuid } from 'uuid'

const log = new Logger('TranslateService')

/** 单个待翻译元素 */
interface TranslateElement {
  id: string
  text: string
  el: HTMLElement
}

/** 批量翻译结果 */
interface TranslateResult {
  id: string
  translated: string
}


/**
 * 翻译服务类
 *
 * 管理翻译生命周期：提取文本 → 过滤代码 → 调用 AI → 替换 DOM。
 * 自动去重，已翻译元素不会重复翻译。
 */
export class TranslateService {
  /** 已翻译列表：{ id, original, translated } */
  private translatedList: Array<{ id: string; original: string; translated: string }> = []
  private abortController: AbortController | null = null
  private isTranslating = false
  /** IntersectionObserver 实例 */
  private observer: IntersectionObserver | null = null
  /** 待翻译队列（元素进入可视区域后暂存，防抖批量发送） */
  private pendingElements: TranslateElement[] = []
  /** 已注册 observer 的元素 id（防止重复注册） */
  private observedIds = new Set<string>()
  /** 防抖定时器 */
  private pendingTimer: ReturnType<typeof setTimeout> | null = null
  /** 当前翻译设置（用于 observer 回调） */
  private currentTargetLang = ''
  private currentSettings: AppSettings | null = null

  /**
   * 划词翻译：翻译单条文本
   *
   * @returns 翻译后的文本（已回填占位符）
   */
  async translateSelection(
    text: string,
    targetLang: string,
    settings: AppSettings,
  ): Promise<string> {
    const { text: filtered, placeholders } = filterCodeText(text)
    log.info('划词翻译', { original: text.slice(0, 50), filtered: filtered.slice(0, 50), placeholders: placeholders.size })

    const translated = await this.callAI(
      filtered,
      targetLang,
      settings,
      false,
    )

    const result = restorePlaceholders(translated, placeholders)
    log.info('划词翻译完成', { result: result.slice(0, 50) })
    return result
  }

  /**
   * 自动翻译：用 IntersectionObserver 监听所有文本元素
   *
   * 元素进入可视区域 → 加入待翻译队列 → 防抖 200ms → 批量翻译。
   * 覆盖页面滚动、元素内滚动、任何可见性变化。
   */
  async translateVisible(
    targetLang: string,
    settings: AppSettings,
  ): Promise<number> {
    this.currentTargetLang = targetLang
    this.currentSettings = settings

    log.info('[自动翻译] 开始全量打标 skeletonId')
    ensureAllSkeletonIds()

    // 提取所有文本元素（不限可视区域，observer 会过滤）
    const elements = this.extractAllTextElements()
    const translatedIds = new Set(this.translatedList.map(t => t.id))
    const newElements = elements.filter(el => !translatedIds.has(el.id))
    log.info('[自动翻译] 扫描完成', { total: elements.length, new: newElements.length, alreadyTranslated: elements.length - newElements.length })

    if (newElements.length === 0) {
      log.info('[自动翻译] 无新元素需要翻译')
      return 0
    }

    // 初始化 observer（如果还没创建）
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => this.onIntersection(entries),
        { rootMargin: '0px', threshold: 0 },
      )
      log.info('[自动翻译] IntersectionObserver 已创建')
    }

    // 把新元素加入 observer（跳过已在队列中或已注册的）
    const pendingIds = new Set(this.pendingElements.map(p => p.id))
    let registered = 0
    for (const el of newElements) {
      if (pendingIds.has(el.id)) continue
      if (this.observedIds.has(el.id)) continue
      this.observer.observe(el.el)
      this.observedIds.add(el.id)
      registered++
    }
    log.info('[自动翻译] 已注册 observer', { registered, skipped: newElements.length - registered })

    return newElements.length
  }

  /**
   * IntersectionObserver 回调：元素进入可视区域
   */
  private onIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      // 离开可视区域 → 跳过
      if (!entry.isIntersecting) continue

      const el = entry.target as HTMLElement
      const id = el.dataset.skeletonId
      if (!id) continue

      // 已翻译或已在队列中 → 取消观察
      const translatedIds = new Set(this.translatedList.map(t => t.id))
      if (translatedIds.has(id) || this.pendingElements.some(p => p.id === id)) {
        this.observer?.unobserve(el)
        continue
      }

      const text = this.getDirectText(el)
      if (!text || text.length < 2) {
        this.observer?.unobserve(el)
        continue
      }

      // 加入待翻译队列
      this.pendingElements.push({ id, text, el })
      this.observer?.unobserve(el)

      // 防抖 200ms 后批量翻译
      if (this.pendingTimer) clearTimeout(this.pendingTimer)
      this.pendingTimer = setTimeout(() => this.flushPending(), 200)
    }
  }

  /**
   * 处理待翻译队列
   *
   * 核心逻辑：按文本去重后发给 AI，翻译结果回填到所有相同文本的元素。
   */
  private async flushPending(): Promise<void> {
    if (this.pendingElements.length === 0) return
    if (!this.currentSettings || !this.currentTargetLang) return

    // 取出队列并清空
    const batch = [...this.pendingElements]
    this.pendingElements = []

    if (this.isTranslating) {
      log.debug('[自动翻译] 翻译进行中，重新入队')
      this.pendingElements.push(...batch)
      return
    }

    this.isTranslating = true
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    try {
      log.info('[自动翻译] 翻译队列出队', { count: batch.length })

      // 按文本去重：text → { representativeId, placeholder, allElements[] }
      const textGroupMap = new Map<string, {
        representativeId: string
        filtered: string
        placeholders: Map<string, string>
        elements: TranslateElement[]
      }>()

      for (const el of batch) {
        const { text: filtered, placeholders } = filterCodeText(el.text)
        const existing = textGroupMap.get(filtered)
        if (existing) {
          existing.elements.push(el)
        } else {
          textGroupMap.set(filtered, {
            representativeId: el.id,
            filtered,
            placeholders,
            elements: [el],
          })
        }
      }

      // 给所有元素添加 loading
      for (const el of batch) {
        this.addLoadingMark(el.el)
      }

      // 构建去重后的翻译列表（只发唯一文本）
      const translateItems: Array<{ id: string; text: string }> = []
      const groupById = new Map<string, typeof textGroupMap extends Map<string, infer V> ? V : never>()

      for (const [, group] of textGroupMap) {
        translateItems.push({ id: group.representativeId, text: group.filtered })
        groupById.set(group.representativeId, group)
      }

      log.info('[自动翻译] 文本去重', { before: batch.length, after: translateItems.length })

      // 调用 AI
      const results = await this.callAIBatch(
        translateItems,
        this.currentTargetLang,
        this.currentSettings,
        signal,
      )

      log.info('[自动翻译] AI 返回', { requested: translateItems.length, received: results.length })

      // 替换 DOM：翻译结果回填到所有相同文本的元素
      let translatedCount = 0
      for (const { id, translated } of results) {
        if (signal.aborted) break

        const group = groupById.get(id)
        if (!group) continue

        const finalText = group.placeholders.size > 0
          ? restorePlaceholders(translated, group.placeholders)
          : translated

        // 同一文本的所有元素都替换 + 清 loading
        for (const el of group.elements) {
          this.replaceElementText(el.el, finalText)
          this.removeLoadingMark(el.el)
          this.translatedList.push({ id: el.id, original: el.text, translated: finalText })
          translatedCount++
        }
      }

      // 取消时清除所有 loading
      if (signal.aborted) {
        for (const el of batch) this.removeLoadingMark(el.el)
      }

      log.info('[自动翻译] 本轮完成', { translatedCount, totalCached: this.translatedList.length })
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        log.error('[自动翻译] 翻译失败', error)
      }
      for (const el of batch) this.removeLoadingMark(el.el)
    } finally {
      this.isTranslating = false
      this.abortController = null
      // AI 回复完成，清除页面上所有 loading 标记
      document.querySelectorAll('.zwf-tl-loading').forEach(m => m.remove())
    }
  }

  /**
   * 增量翻译（保留接口兼容，observer 模式下无需手动调用）
   */
  async translateIncremental(
    targetLang: string,
    settings: AppSettings,
  ): Promise<number> {
    return this.translateVisible(targetLang, settings)
  }

  /** 取消正在进行的翻译 */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    this.isTranslating = false
  }

  /** 还原所有翻译（关闭自动翻译时调用） */
  restoreAll(): void {
    log.info('[自动翻译] 还原文本', { count: this.translatedList.length })
    for (const { id, original } of this.translatedList) {
      const el = document.querySelector(`[data-skeleton-id="${id}"]`) as HTMLElement | null
      if (el) {
        this.replaceElementText(el, original)
        this.removeLoadingMark(el)
      }
    }
    document.querySelectorAll('.zwf-tl-loading').forEach(m => m.remove())
    this.translatedList = []
    this.pendingElements = []
    this.observedIds.clear()
    this.disconnectObserver()
  }

  /** 重置状态（页面切换时调用） */
  reset(): void {
    this.translatedList = []
    this.pendingElements = []
    this.observedIds.clear()
    this.disconnectObserver()
    this.abort()
  }

  /** 断开 observer */
  private disconnectObserver(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
      log.info('[自动翻译] IntersectionObserver 已断开')
    }
  }

  /** 是否正在翻译中 */
  get busy(): boolean {
    return this.isTranslating
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 提取可视窗口内有文本的元素
   *
   * 复用 skeleton.ts 的可视窗口检测逻辑。
   * 过滤代码元素（Layer 1 + Layer 2）。
   */
  /**
   * 提取页面所有文本元素（不限可视区域）
   *
   * IntersectionObserver 会自动过滤不可见的元素。
   * 这里只做基本过滤：代码元素、无文本、纯数字。
   */
  private extractAllTextElements(): TranslateElement[] {
    const candidates: TranslateElement[] = []
    const allEls = document.body.querySelectorAll('*:not(script,style,noscript,meta,link,br,hr)')

    let scanned = 0, skippedCode = 0, skippedInvisible = 0, skippedText = 0

    for (const el of allEls) {
      scanned++
      const htmlEl = el as HTMLElement

      if (isCodeElement(htmlEl)) { skippedCode++; continue }
      if (!this.isElementVisible(htmlEl)) { skippedInvisible++; continue }

      const id = htmlEl.dataset.skeletonId || ensureSkeletonId(htmlEl)
      const text = this.getDirectText(htmlEl)
      if (!text || text.length < 2) { skippedText++; continue }
      if (/^[\d\s.,%+\-*/=<>]+$/.test(text)) { skippedText++; continue }

      candidates.push({ id, text, el: htmlEl })
    }

    // 父子去重：只在父子文本完全相同时跳过子元素
    // 不用 includes，因为父元素文本通常是所有子文本的拼接
    const candidateIds = new Set(candidates.map(c => c.id))
    const elements: TranslateElement[] = []

    for (const c of candidates) {
      let dominated = false
      let parent = c.el.parentElement
      while (parent) {
        const pid = parent.dataset.skeletonId
        if (pid && candidateIds.has(pid)) {
          const pCandidate = candidates.find(x => x.id === pid)
          if (pCandidate && pCandidate.text === c.text) {
            dominated = true
            break
          }
        }
        parent = parent.parentElement
      }
      if (!dominated) elements.push(c)
    }

    log.info('[自动翻译] 元素扫描统计', { scanned, candidates: candidates.length, afterDedup: elements.length, skippedCode, skippedInvisible, skippedText })
    return elements
  }

  /** 元素可见性检查 */
  private isElementVisible(el: HTMLElement): boolean {
    try {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      return el.offsetParent !== null || style.position === 'fixed'
    } catch {
      return false
    }
  }

  /** 提取元素直接文本（复用 skeleton.ts 逻辑） */
  private getDirectText(el: HTMLElement): string {
    let text = ''
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent?.trim() || ''
      }
    }
    if (!text) {
      for (const child of el.children) {
        const childText = (child as HTMLElement).innerText?.trim() || ''
        if (childText) { text = childText; break }
      }
    }
    if (!text) {
      text = el.getAttribute('aria-label') || el.getAttribute('title') || ''
    }
    return text.trim().slice(0, 500) // 翻译场景允许更长文本
  }

  /** 给元素添加 loading 标记（旋转圈圈，紧跟文本） */
  private addLoadingMark(el: HTMLElement): void {
    if (el.querySelector('.zwf-tl-loading')) return

    // 只给有直接文本节点的元素加 loading，容器元素不加
    let hasDirectText = false
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        hasDirectText = true
        break
      }
    }
    if (!hasDirectText) {
      // 没有直接文本节点，找第一个有文本的子元素
      for (const child of el.children) {
        const childEl = child as HTMLElement
        for (const node of childEl.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            hasDirectText = true
            break
          }
        }
        if (hasDirectText) break
      }
    }
    if (!hasDirectText) return

    if (!document.getElementById('zwf-tl-loading-style')) {
      const style = document.createElement('style')
      style.id = 'zwf-tl-loading-style'
      style.textContent = `
        @keyframes zwf-tl-spin {
          to { transform: rotate(360deg); }
        }
        .zwf-tl-loading {
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid #409eff;
          border-top-color: transparent;
          border-radius: 50%;
          animation: zwf-tl-spin 0.6s linear infinite;
          vertical-align: middle;
          margin-left: 4px;
        }
      `
      document.head.appendChild(style)
    }

    const mark = document.createElement('span')
    mark.className = 'zwf-tl-loading'
    mark.setAttribute('translate', 'no')
    el.appendChild(mark)
  }

  /** 移除元素的 loading 标记 */
  private removeLoadingMark(el: HTMLElement): void {
    const mark = el.querySelector('.zwf-tl-loading')
    if (mark) mark.remove()
  }

  /**
   * 替换元素文本（只操作 textNode，不改变样式/结构）
   *
   * 策略：
   * 1. 找到第一个非空 textNode → 直接替换
   * 2. 没有 textNode → 找第一个有文本的子元素，递归替换其 textNode
   * 3. 都没有 → 设置 textContent（兜底）
   */
  private replaceElementText(el: HTMLElement, translated: string): void {
    // 策略 1：直接子 textNode
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        node.textContent = translated
        return
      }
    }

    // 策略 2：子元素的 textNode（不改子元素本身）
    for (const child of el.children) {
      const childEl = child as HTMLElement
      for (const node of childEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
          node.textContent = translated
          return
        }
      }
    }

    // 策略 3：兜底 — 仅当没有任何子元素时才用 textContent
    if (el.children.length === 0) {
      el.textContent = translated
    }
  }

  /**
   * 调用 AI 翻译单条文本（流式收集完整结果）
   */
  private async callAI(
    text: string,
    targetLang: string,
    settings: AppSettings,
    isBatch: boolean,
  ): Promise<string> {
    const adapter = this.getAdapter(settings)
    const modelName = this.getModelName(settings)
    const messages = this.buildMessages(
      buildSelectionTranslateMessage(text, targetLang),
      settings,
    )

    log.info('[划词翻译] 调用 AI', { model: modelName, textLength: text.length, targetLang })

    let result = ''
    await adapter.chat(
      {
        baseUrl: this.getBaseUrl(settings),
        apiKey: settings.apiKey,
        modelName,
        provider: settings.provider,
        messages,
      },
      (chunk: StreamChunk) => {
        if (chunk.delta) result += chunk.delta
      },
    )

    log.info('[划词翻译] AI 响应', { rawLength: result.length, preview: result.slice(0, 80) })
    return parseSingleTranslation(result)
  }

  /**
   * 调用 AI 批量翻译（流式收集完整结果后解析 JSON）
   */
  private async callAIBatch(
    items: Array<{ id: string; text: string }>,
    targetLang: string,
    settings: AppSettings,
    signal: AbortSignal,
  ): Promise<TranslateResult[]> {
    const adapter = this.getAdapter(settings)
    const modelName = this.getModelName(settings)
    const messages = this.buildMessages(
      buildAutoTranslateMessage(items, targetLang),
      settings,
    )

    log.info('[自动翻译] 调用 AI 批量翻译', { model: modelName, itemCount: items.length, targetLang })
    for (const item of items) {
      log.debug('[自动翻译] 待翻译项', { id: item.id, text: item.text.slice(0, 60) })
    }

    let result = ''
    await adapter.chat(
      {
        baseUrl: this.getBaseUrl(settings),
        apiKey: settings.apiKey,
        modelName,
        provider: settings.provider,
        messages,
        signal,
      },
      (chunk: StreamChunk) => {
        if (chunk.delta) result += chunk.delta
      },
    )

    log.info('[自动翻译] AI 响应', { rawLength: result.length, preview: result.slice(0, 200) })
    const parsed = parseTranslateResponse(result)
    log.info('[自动翻译] 解析结果', { parsedCount: parsed.length })
    return parsed
  }

  /** 获取适配器 */
  private getAdapter(settings: AppSettings) {
    return createAdapter(settings.provider)
  }

  /** 获取 baseUrl（模型独立配置优先） */
  private getBaseUrl(settings: AppSettings): string {
    const model = settings.models.find(m => m.id === settings.defaultModelId)
    return model?.baseUrl || settings.baseUrl || ''
  }

  /** 获取模型名 */
  private getModelName(settings: AppSettings): string {
    const model = settings.models.find(m => m.id === settings.defaultModelId)
    return model?.modelName || ''
  }

  /** 构建消息数组（翻译指令 + 用户内容合并到 user 消息） */
  private buildMessages(userContent: string, settings: AppSettings): ChatMessage[] {
    return [
      {
        id: uuid(),
        role: 'user' as const,
        content: `${TRANSLATE_SYSTEM_PROMPT}\n\n${userContent}`,
        timestamp: Date.now(),
      },
    ]
  }

  /** 数组分块 */
  private chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size))
    }
    return result
  }
}
