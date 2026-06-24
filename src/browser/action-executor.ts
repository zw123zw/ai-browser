/**
 * 浏览器指令执行引擎
 *
 * 三重元素定位：elementId → fallbackSelector → 文本匹配
 * 完整事件触发序列（非简单 .click()）
 */

import { Logger } from '@/src/utils/logger'
import { INTERACTIVE_TAGS } from './types'
import type { Command, ActionResult } from './types'

const log = new Logger('ActionExecutor')

// ═══════════════════════════════════════════════
// 自动滚动状态（持久化到 chrome.storage.local，跨页面/标签页共享）
// ═══════════════════════════════════════════════

const AUTO_SCROLL_KEY = 'local:ai-browser-auto-scroll'

const autoScroll = {
  running: false,
  paused: false,
  animationId: 0,
  container: null as Window | Element | null,
  wheelListener: null as ((e: WheelEvent) => void) | null,
}

/** 保存自动滚动状态到 storage */
function saveAutoScrollState(active: boolean): void {
  try {
    if (active) {
      chrome.storage.local.set({ [AUTO_SCROLL_KEY]: true })
    } else {
      chrome.storage.local.remove(AUTO_SCROLL_KEY)
    }
  } catch { /* storage 可能不可用 */ }
}

/** 检查 storage 中是否有自动滚动状态，有则恢复 */
function restoreAutoScrollIfActive(): void {
  try {
    chrome.storage.local.get(AUTO_SCROLL_KEY, (result) => {
      if (result[AUTO_SCROLL_KEY] && !autoScroll.running) {
        startAutoScrollInternal()
      }
    })
  } catch { /* storage 可能不可用 */ }
}

/** 内部启动自动滚动（供 restore 调用） */
function startAutoScrollInternal(): void {
  if (autoScroll.running) return
  const container = getScrollableContainer()
  autoScroll.running = true
  autoScroll.paused = false
  autoScroll.container = container

  const speed = 1
  const tick = () => {
    if (!autoScroll.running) return
    if (!autoScroll.paused) {
      const info = getScrollInfo(container)
      if (info.current >= info.max - 1) {
        stopAutoScroll()
        log.info('自动滚动到底部，停止')
        return
      }
      scrollContainer(container, speed)
    }
    autoScroll.animationId = requestAnimationFrame(tick)
  }
  autoScroll.animationId = requestAnimationFrame(tick)

  autoScroll.wheelListener = (e: WheelEvent) => {
    if (!autoScroll.running) return
    if (e.deltaY < 0) {
      if (!autoScroll.paused) {
        autoScroll.paused = true
        log.info('滚轮向上，自动滚动暂停')
      }
    } else if (e.deltaY > 0 && autoScroll.paused) {
      autoScroll.paused = false
      log.info('滚轮向下，自动滚动恢复')
    }
  }
  window.addEventListener('wheel', autoScroll.wheelListener, { passive: true })
  log.info('自动滚动开始', { container: container === window ? 'window' : (container as Element)?.tagName })
}

// 页面加载时检查并恢复自动滚动
if (typeof chrome !== 'undefined' && chrome.storage) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreAutoScrollIfActive)
  } else {
    restoreAutoScrollIfActive()
  }
}

/** 获取最近的可滚动容器（从目标元素向上查找） */
function getScrollableContainer(el?: Element | null): Window | Element | null {
  // 如果有目标元素，从它向上找
  let current = el || document.body
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current)
    const overflow = style.overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current
    }
    current = current.parentElement!
  }
  // 兜底：检查 body/html
  if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
    return window
  }
  // body 也不可滚动，尝试找页面内最大的可滚动容器
  const allDivs = document.querySelectorAll('div')
  let best: Element | null = null
  let bestScore = 0
  for (const div of allDivs) {
    if (div.scrollHeight > div.clientHeight + 50) {
      const style = window.getComputedStyle(div)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        const score = div.scrollHeight - div.clientHeight
        if (score > bestScore) {
          bestScore = score
          best = div
        }
      }
    }
  }
  return best || window
}

/** 滚动指定容器 */
function scrollContainer(container: Window | Element | null, deltaY: number): void {
  if (!container || container === window) {
    window.scrollBy(0, deltaY)
  } else {
    (container as Element).scrollTop += deltaY
  }
}

/** 获取容器当前滚动位置和最大值 */
function getScrollInfo(container: Window | Element | null): { current: number; max: number } {
  if (!container || container === window) {
    return {
      current: window.scrollY || document.documentElement.scrollTop,
      max: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }
  }
  const el = container as Element
  return { current: el.scrollTop, max: el.scrollHeight - el.clientHeight }
}

/** 停止自动滚动 */
function stopAutoScroll(): void {
  if (autoScroll.animationId) {
    cancelAnimationFrame(autoScroll.animationId)
    autoScroll.animationId = 0
  }
  if (autoScroll.wheelListener) {
    window.removeEventListener('wheel', autoScroll.wheelListener)
    autoScroll.wheelListener = null
  }
  autoScroll.running = false
  autoScroll.paused = false
  autoScroll.container = null
  saveAutoScrollState(false)
}

export class ActionExecutor {
  /**
   * 执行单条指令
   */
  async execute(cmd: Command, signal?: AbortSignal): Promise<ActionResult> {
    log.info('═══ 执行指令开始 ═══', { action: cmd.action, elementId: cmd.elementId, description: cmd.description })

    // iframe 元素（f_ 前缀）→ 通过 background 中转注入到 iframe 执行
    if (cmd.elementId?.startsWith('f_')) {
      return await this.executeIframeAction(cmd)
    }

    // 不需要元素的操作（keyboard/press 作用于当前焦点元素，tab 操作走 background）
    const needsElement = !['navigate', 'wait', 'scroll', 'keyboard', 'press', 'newTab', 'closeTab', 'switchTab', 'nextTab', 'prevTab'].includes(cmd.action)
    let element: HTMLElement | null = null

    if (needsElement) {
      element = this.findElement(cmd)
      if (!element) {
        const msg = `未找到目标元素: ${cmd.description || cmd.elementId || cmd.action}`
        log.error(msg)
        return { success: false, message: msg }
      }
    }

    try {
      let result: ActionResult
      switch (cmd.action) {
        case 'click':     result = await this.executeClick(element!); break
        case 'type':      result = await this.executeType(element!, cmd.text || ''); break
        case 'clear':     result = await this.executeClear(element!); break
        case 'scroll':    result = await this.executeScroll(cmd.direction || 'down', cmd.amount); break
        case 'navigate':  result = await this.executeNavigate(cmd.url || ''); break
        case 'select':    result = await this.executeSelect(element!, cmd.text || ''); break
        case 'keyboard':
        case 'press':     result = await this.executeKeyboard(cmd.key || ''); break
        case 'focus':     result = await this.executeFocus(element!); break
        case 'hover':     result = await this.executeHover(element!); break
        case 'wait':      result = await this.executeWait(cmd.ms || 1000, signal); break
        case 'newTab':    result = await this.executeTabAction('newTab'); break
        case 'closeTab':  result = await this.executeTabAction('closeTab'); break
        case 'switchTab': result = await this.executeTabAction('switchTab', cmd.tabQuery || cmd.description); break
        case 'nextTab':   result = await this.executeTabAction('switchTab', 'next'); break
        case 'prevTab':   result = await this.executeTabAction('switchTab', 'prev'); break
        case 'video':     result = await this.executeVideo(element!, cmd.subAction || '', cmd.value); break
        default:          result = { success: false, message: `未知操作类型: ${cmd.action}` }
      }
      log.info('═══ 执行指令完成 ═══', { action: cmd.action, success: result.success, message: result.message })
      return result
    } catch (error) {
      // abort 直接抛出，不当作执行失败
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const msg = `执行异常: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg, error)
      return { success: false, message: msg }
    }
  }

  // ========== 三重元素定位 ==========

  private findElement(cmd: Command): HTMLElement | null {
    log.info('findElement 开始', { elementId: cmd.elementId, fallbackSelector: cmd.fallbackSelector, description: cmd.description })

    // 第一优先：elementId（骨架中的 id）
    if (cmd.elementId) {
      const el = document.querySelector(`[data-skeleton-id="${cmd.elementId}"]`)
      if (el) {
        log.info('findElement 通过 elementId 找到元素', { elementId: cmd.elementId, tag: el.tagName, className: (el as HTMLElement).className })
        return el as HTMLElement
      } else {
        log.warn('findElement elementId 未找到元素', { elementId: cmd.elementId })
      }
    }

    // 第二优先：fallbackSelector（CSS 选择器）
    if (cmd.fallbackSelector) {
      try {
        const el = document.querySelector(cmd.fallbackSelector)
        if (el) {
          log.info('findElement 通过 fallbackSelector 找到元素', { selector: cmd.fallbackSelector, tag: el.tagName, className: (el as HTMLElement).className })
          return el as HTMLElement
        } else {
          log.warn('findElement fallbackSelector 未找到元素', { selector: cmd.fallbackSelector })
        }
      } catch (error) {
        log.warn('findElement fallbackSelector 查询失败', { selector: cmd.fallbackSelector, error })
      }
    }

    // 第三优先：文本内容匹配
    if (cmd.description) {
      const el = this.findByText(cmd.description)
      if (el) {
        log.info('findElement 通过文本匹配找到元素', { text: cmd.description, tag: el.tagName, className: el.className })
        return el
      } else {
        log.warn('findElement 文本匹配未找到元素', { text: cmd.description })
      }
    }

    log.warn('findElement 未找到任何元素')
    return null
  }

  /** 文本模糊匹配查找元素 */
  private findByText(text: string): HTMLElement | null {
    // 优先搜索交互元素（使用统一的 INTERACTIVE_TAGS + 属性选择器）
    const interactiveSelector = INTERACTIVE_TAGS.join(', ') + ', [role="button"], [onclick], [tabindex]'
    const interactive = document.querySelectorAll(interactiveSelector)
    for (const el of interactive) {
      const elText = el.textContent?.trim() || ''
      const ariaLabel = el.getAttribute('aria-label') || ''
      const title = el.getAttribute('title') || ''
      const placeholder = el.getAttribute('placeholder') || ''
      if (elText.includes(text) || ariaLabel.includes(text) || title.includes(text) || placeholder.includes(text)) {
        return el as HTMLElement
      }
    }

    // 兜底：搜索所有元素（覆盖 div/span + SVG 图标按钮）
    const allElements = document.querySelectorAll('*')
    for (const el of allElements) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'SVG') continue
      const elText = el.textContent?.trim() || ''
      const ariaLabel = el.getAttribute('aria-label') || ''
      const title = el.getAttribute('title') || ''
      const placeholder = (el as HTMLElement).getAttribute?.('placeholder') || ''
      if (elText.includes(text) || ariaLabel.includes(text) || title.includes(text) || placeholder.includes(text)) {
        // 过滤不可见元素
        const style = window.getComputedStyle(el as HTMLElement)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        return el as HTMLElement
      }
    }

    return null
  }

  // ========== 操作执行 ==========

  /** 触发点击事件：完整的 Pointer + 鼠标事件序列（pointerdown → mousedown → focus → pointerup → mouseup → click） */
  private triggerClick(el: HTMLElement): void {
    log.info('triggerClick 开始', { tag: el.tagName, className: el.className, id: el.id })
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }
    const pointerEventInit: PointerEventInit = {
      ...eventInit,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }

    // 完整事件序列：模拟真实浏览器点击
    // PointerEvent 优先于 MouseEvent —— 现代 SPA（Vue 3、React 17+）的按钮组件
    // 常监听 pointerdown/pointerup 而非 mousedown/mouseup，仅派发 MouseEvent 无法触发
    el.dispatchEvent(new PointerEvent('pointerdown', pointerEventInit))
    el.dispatchEvent(new MouseEvent('mousedown', eventInit))
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointerup', pointerEventInit))
    el.dispatchEvent(new MouseEvent('mouseup', eventInit))
    el.dispatchEvent(new MouseEvent('click', eventInit))
    log.info('triggerClick 完整事件序列执行完成')
  }

  /** 点击：区分真实链接 vs JS 交互型链接 */
  private async executeClick(el: HTMLElement): Promise<ActionResult> {
    log.info('executeClick 开始', { tag: el.tagName, className: el.className, id: el.id })

    // label 点击：自动转发到关联的表单元素（input/select/textarea）
    // 用户说"点击活动区域"时 AI 可能选中 label，但实际需要操作的是关联的 select/input
    if (el.tagName === 'LABEL') {
      const formEl = this.findLabelTarget(el)
      if (formEl) {
        log.info('executeClick label 转发到关联元素', { targetTag: formEl.tagName, targetId: formEl.dataset.skeletonId })
        el = formEl
      }
    }

    // <a> 标签：区分真实链接 vs JS 交互型链接
    if (el instanceof HTMLAnchorElement) {
      const href = el.getAttribute('href') || ''
      log.info('executeClick <a> 标签', { href })
      if (!href || href === '#' || href.startsWith('javascript:')) {
        // javascript: / # / 空 href → 依赖 JS 事件处理器，可能触发 window.open
        log.info('executeClick 调用 triggerClick（交互型链接）')
        const origOpen = window.open
        let detectedNewTab = false
        try {
          window.open = (...args: Parameters<typeof window.open>) => {
            detectedNewTab = true
            return origOpen.apply(window, args)
          }
          this.triggerClick(el)
        } finally {
          window.open = origOpen
        }
        if (detectedNewTab) {
          return { success: true, message: '点击成功，新标签页打开中', openedNewTab: true }
        }
      } else if (el.href) {
        // 真实 URL → 根据 target 判断是否新开页面
        const target = el.target || '_self'  // 默认当前页面
        log.info('executeClick 真实 URL 跳转', { href: el.href, target })
        // _self / _top / _parent 都是当前页（或父 frame）导航
        if (!target || target === '_self' || target === '_top' || target === '_parent') {
          window.location.href = el.href
          return { success: true, message: '点击成功，页面跳转中' }
        } else {
          // _blank 或命名 frame：新开标签
          const opened = window.open(el.href, target)
          if (!opened) {
            // popup blocker 拦截 → 回退到当前页跳转
            window.location.href = el.href
            return { success: true, message: '点击成功，页面跳转中' }
          }
          return { success: true, message: '点击成功，新标签页打开中', openedNewTab: true }
        }
      }
    } else {
      log.info('executeClick 非 <a> 标签，调用 triggerClick', { tag: el.tagName })
      // 临时 patch window.open，检测按钮事件处理器是否调用了 window.open
      const origOpen = window.open
      let detectedNewTab = false
      try {
        window.open = (...args: Parameters<typeof window.open>) => {
          detectedNewTab = true
          return origOpen.apply(window, args)
        }
        this.triggerClick(el)
      } finally {
        window.open = origOpen
      }
      if (detectedNewTab) {
        return { success: true, message: '点击成功，新标签页打开中', openedNewTab: true }
      }
    }

    log.info('executeClick 完成')
    return { success: true, message: '点击成功' }
  }

  /** 输入：focus → 设置值 → 触发 input/change 事件（兼容 React/Vue/各种编辑器） */
  private async executeType(el: HTMLElement, text: string): Promise<ActionResult> {
    el.focus()
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

    // 1. CodeMirror 编辑器（ByteMD 等）
    const cmElement = el.closest('.CodeMirror') as HTMLElement & {
      CodeMirror?: {
        setValue: (v: string) => void
        trigger?: (name: string, ...args: unknown[]) => void
      }
    }
    if (cmElement?.CodeMirror) {
      cmElement.CodeMirror.setValue(text)
      // 触发 change 事件，让 ByteMD 等上层框架同步内容
      cmElement.CodeMirror.trigger?.('change')
      return { success: true, message: `输入成功: ${text}` }
    }

    // 2. Monaco 编辑器
    const monacoElement = el.closest('.monaco-editor') as HTMLElement & { __editor?: { setValue: (v: string) => void } }
    if (monacoElement?.__editor) {
      monacoElement.__editor.setValue(text)
      // 触发 input 事件，让上层框架同步
      monacoElement.dispatchEvent(new Event('input', { bubbles: true }))
      return { success: true, message: `输入成功: ${text}` }
    }

    // 3. Ace 编辑器
    const aceElement = el.closest('.ace_editor') as HTMLElement & { env?: { editor?: { session?: { setValue: (v: string) => void } } } }
    if (aceElement?.env?.editor?.session) {
      aceElement.env.editor.session.setValue(text)
      // 触发 input 事件，让上层框架同步
      aceElement.dispatchEvent(new Event('input', { bubbles: true }))
      return { success: true, message: `输入成功: ${text}` }
    }

    // 4. contenteditable 元素（Quill/TinyMCE/CKEditor/ProseMirror/TipTap 等）
    if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
      // 选中所有内容，然后插入新文本
      document.execCommand('selectAll', false, undefined)
      document.execCommand('insertText', false, text)
      return { success: true, message: `输入成功: ${text}` }
    }

    // 5. 标准 input/textarea
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // 使用 nativeInputValueSetter 绕过 React/Vue 受控组件
      const proto = el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (nativeSetter) {
        nativeSetter.call(el, text)
      } else {
        el.value = text
      }
    }

    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))

    return { success: true, message: `输入成功: ${text}` }
  }

  /** 清空输入框 */
  private async executeClear(el: HTMLElement): Promise<ActionResult> {
    return this.executeType(el, '')
  }

  /** 键盘操作：keydown → keypress → keyup（Enter 时尝试提交表单） */
  private async executeKeyboard(key: string): Promise<ActionResult> {
    const target = document.activeElement || document.body
    const keyEventInit: KeyboardEventInit = {
      key,
      code: this.getKeyCode(key),
      bubbles: true,
      cancelable: true,
    }

    target.dispatchEvent(new KeyboardEvent('keydown', keyEventInit))
    target.dispatchEvent(new KeyboardEvent('keypress', keyEventInit))
    target.dispatchEvent(new KeyboardEvent('keyup', keyEventInit))

    // Enter 键：尝试提交表单（合成事件不触发浏览器默认行为）
    if (key === 'Enter') {
      // 优先从 activeElement 找 form
      if (target instanceof HTMLElement) {
        const form = target.closest('form')
        if (form) {
          form.requestSubmit()
          return { success: true, message: '回车提交表单' }
        }
      }
      // 兜底：全局找搜索输入框并提交
      const searchInput = document.querySelector<HTMLInputElement>(
        'input[type="search"], input[name="q"], input[name="keyword"], input[name="wd"], input[placeholder*="搜索"], input[placeholder*="search"]'
      )
      if (searchInput) {
        const form = searchInput.closest('form')
        if (form) {
          form.requestSubmit()
          return { success: true, message: '回车提交搜索表单' }
        }
      }
    }

    return { success: true, message: `键盘操作: ${key}` }
  }

  /** 将 key 名映射为正确的 KeyboardEvent.code */
  private getKeyCode(key: string): string {
    const specialKeys: Record<string, string> = {
      'Enter': 'Enter',
      'Escape': 'Escape',
      'Esc': 'Escape',
      'Tab': 'Tab',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'ArrowUp': 'ArrowUp',
      'ArrowDown': 'ArrowDown',
      'ArrowLeft': 'ArrowLeft',
      'ArrowRight': 'ArrowRight',
      'Home': 'Home',
      'End': 'End',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown',
      'Space': 'Space',
      ' ': 'Space',
    }
    if (specialKeys[key]) return specialKeys[key]
    // 单个字母键 → KeyX 格式
    if (key.length === 1 && /[a-zA-Z]/.test(key)) return `Key${key.toUpperCase()}`
    // 数字键 → DigitX
    if (key.length === 1 && /[0-9]/.test(key)) return `Digit${key}`
    // 兜底
    return key
  }

  /** 导航（通过 background 新标签页打开，避免 popup 拦截） */
  private async executeNavigate(url: string): Promise<ActionResult> {
    if (!url) return { success: false, message: '未指定 URL' }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'tab-action',
        action: 'newTab',
        url,
      })
      if (response?.success) {
        return { success: true, message: `新标签页打开: ${url}` }
      }
      return { success: false, message: response?.error || '导航失败' }
    } catch (error) {
      const msg = `导航异常: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg, error)
      return { success: false, message: msg }
    }
  }

  /** 滚动（支持 up/down/top/bottom/auto/stop/pause/resume） */
  private async executeScroll(direction: string, amount?: number): Promise<ActionResult> {
    // ── auto：开始自动向下滚动 ──
    if (direction === 'auto') {
      if (autoScroll.running) {
        return { success: false, message: '自动滚动已在运行中' }
      }
      startAutoScrollInternal()
      saveAutoScrollState(true)
      return { success: true, message: '开始自动滚动' }
    }

    // ── stop：停止自动滚动 ──
    if (direction === 'stop') {
      if (!autoScroll.running) {
        return { success: false, message: '自动滚动未运行' }
      }
      stopAutoScroll()
      return { success: true, message: '自动滚动已停止' }
    }

    // ── pause：暂停自动滚动 ──
    if (direction === 'pause') {
      if (!autoScroll.running) {
        return { success: false, message: '自动滚动未运行' }
      }
      autoScroll.paused = true
      return { success: true, message: '自动滚动已暂停' }
    }

    // ── resume：恢复自动滚动 ──
    if (direction === 'resume') {
      if (!autoScroll.running) {
        return { success: false, message: '自动滚动未运行' }
      }
      autoScroll.paused = false
      return { success: true, message: '自动滚动已恢复' }
    }

    // ── 一次性滚动（up/down/top/bottom）──
    const container = getScrollableContainer()
    const scrollAmount = amount || window.innerHeight * 0.8

    switch (direction) {
      case 'up':     scrollContainer(container, -scrollAmount); break
      case 'down':   scrollContainer(container, scrollAmount); break
      case 'top':
        if (!container || container === window) window.scrollTo(0, 0)
        else (container as Element).scrollTop = 0
        break
      case 'bottom': {
        const info = getScrollInfo(container)
        scrollContainer(container, info.max)
        break
      }
      default:
        return { success: false, message: `未知滚动方向: ${direction}` }
    }

    // 等待浏览器完成滚动和重绘（两帧 + 500ms 保险）
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 500))))
    return { success: true, message: `滚动: ${direction}` }
  }

  /** 下拉框选择 */
  private async executeSelect(el: HTMLElement, value: string): Promise<ActionResult> {
    if (!(el instanceof HTMLSelectElement)) {
      return { success: false, message: '目标元素不是下拉框' }
    }
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { success: true, message: `选择: ${value}` }
  }

  /** 聚焦 */
  private async executeFocus(el: HTMLElement): Promise<ActionResult> {
    el.focus()
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    return { success: true, message: '聚焦成功' }
  }

  /** 悬停 */
  private async executeHover(el: HTMLElement): Promise<ActionResult> {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const common = { bubbles: true, clientX: x, clientY: y, screenX: x, screenY: y }

    // 按顺序派发完整鼠标事件链，最大化触发 CSS :hover 和 JS 事件监听
    el.dispatchEvent(new PointerEvent('pointerover', common))
    el.dispatchEvent(new PointerEvent('pointerenter', common))
    el.dispatchEvent(new MouseEvent('mouseover', common))
    el.dispatchEvent(new MouseEvent('mouseenter', common))
    el.dispatchEvent(new PointerEvent('pointermove', common))
    el.dispatchEvent(new MouseEvent('mousemove', common))

    return { success: true, message: '悬停成功' }
  }

  /** 等待（支持 abort 中断） */
  private async executeWait(ms: number, signal?: AbortSignal): Promise<ActionResult> {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }, { once: true })
    })
    return { success: true, message: `等待 ${ms}ms` }
  }

  // ========== 标签页操作（通过 background 代理） ==========

  /** 标签页操作：通过 chrome.runtime.sendMessage 调用 background 的 tabs API */
  private async executeTabAction(
    tabAction: 'newTab' | 'closeTab' | 'switchTab',
    tabQuery?: string,
  ): Promise<ActionResult> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'tab-action',
        action: tabAction,
        query: tabQuery,
      })
      if (response?.success) {
        return { success: true, message: response.message || `${tabAction} 成功` }
      }
      return { success: false, message: response?.error || `${tabAction} 失败` }
    } catch (error) {
      const msg = `标签页操作异常: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg, error)
      return { success: false, message: msg }
    }
  }

  // ========== Label 辅助 ==========

  /** 查找 label 关联的表单元素 */
  private findLabelTarget(label: HTMLLabelElement): HTMLElement | null {
    const formTags = 'input, select, textarea'

    // 方式 1：for 属性
    const forId = label.getAttribute('for')
    if (forId) {
      const target = document.getElementById(forId)
      if (target && formTags.includes(target.tagName.toLowerCase())) {
        return target as HTMLElement
      }
    }

    // 方式 2：label 内嵌的表单元素
    const inner = label.querySelector(formTags)
    if (inner) return inner as HTMLElement

    // 方式 3：同级容器内的表单元素（Element UI 等组件库模式）
    const parent = label.parentElement
    if (parent) {
      const sibling = parent.querySelector(formTags)
      if (sibling) return sibling as HTMLElement
    }

    return null
  }

  // ========== Video 操作 ==========

  /** Video 操作：play/pause/volume/mute/unmute/seek/jump/speed/fullscreen */
  private async executeVideo(el: HTMLElement, subAction: string, value?: number): Promise<ActionResult> {
    // 找到 video 元素（可能是 el 本身，也可能是 el 的子元素或父元素附近）
    let video: HTMLVideoElement | null = null
    if (el instanceof HTMLVideoElement) {
      video = el
    } else {
      video = el.querySelector('video') || el.closest('video')
    }

    if (!video) {
      return { success: false, message: '未找到视频元素' }
    }

    try {
      switch (subAction) {
        case 'fullscreen':
          // 全屏需要用户手势，浏览器安全限制不允许程序化调用
          // 请用 click action 点击全屏按钮
          return { success: false, message: '全屏需要用户手势，请用 click 点击全屏按钮' }

        case 'play':
          await video.play()
          return { success: true, message: '播放' }

        case 'pause':
          video.pause()
          return { success: true, message: '暂停' }

        case 'volume': {
          const vol = Math.max(0, Math.min(1, value ?? 0.5))
          video.volume = vol
          video.muted = false  // 设置音量时自动取消静音
          return { success: true, message: `音量: ${Math.round(vol * 100)}%` }
        }

        case 'mute':
          video.muted = true
          return { success: true, message: '已静音' }

        case 'unmute':
          video.muted = false
          return { success: true, message: '已取消静音' }

        case 'seek': {
          // 快进/快退（相对当前时间）
          const delta = value ?? 10
          video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta))
          return { success: true, message: `${delta > 0 ? '快进' : '快退'} ${Math.abs(delta)}秒 → ${formatTime(video.currentTime)}` }
        }

        case 'jump': {
          // 跳转到指定时间（绝对时间）
          const time = value ?? 0
          video.currentTime = Math.max(0, Math.min(video.duration || Infinity, time))
          return { success: true, message: `跳转到 ${formatTime(video.currentTime)}` }
        }

        case 'speed': {
          const rate = value ?? 1
          video.playbackRate = rate
          return { success: true, message: `播放速度: ${rate}x` }
        }

        default:
          return { success: false, message: `未知 video 子操作: ${subAction}` }
      }
    } catch (error) {
      const msg = `video ${subAction} 失败: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg, error)
      return { success: false, message: msg }
    }
  }

  /**
   * iframe 内元素操作
   *
   * 通过 chrome.scripting.executeScript 注入操作函数到目标 iframe，
   * 在 iframe 上下文中执行 click/type/select/focus/hover。
   */
  private async executeIframeAction(cmd: Command): Promise<ActionResult> {
    // 去掉 f_ 前缀，得到 iframe 内的真实 skeletonId
    const elementId = (cmd.elementId || '').replace(/^f_/, '')
    const action = cmd.action

    try {
      // 通过 background 中转调用 chrome.scripting.executeScript
      const response = await new Promise<{ result?: { success: boolean; message: string }; error?: string }>(resolve => {
        chrome.runtime.sendMessage({
          type: 'execute-iframe-action',
          action,
          elementId,
          text: cmd.text || '',
          key: cmd.key || '',
        }, resolve)
      })

      if (response.error) {
        log.warn('iframe 操作失败', { error: response.error })
        return { success: false, message: `iframe 操作失败: ${response.error}` }
      }

      if (response.result) {
        log.info('iframe 操作完成', { action, elementId, success: response.result.success, message: response.result.message })
        return response.result
      }
      return { success: false, message: 'iframe 操作无返回结果' }
    } catch (err) {
      const msg = `iframe 操作失败: ${err instanceof Error ? err.message : String(err)}`
      log.warn(msg)
      return { success: false, message: msg }
    }
  }
}

/** 格式化时间为 mm:ss */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * 注入到 iframe 的自包含操作函数
 *
 * 不依赖外部导入，在 iframe 的隔离上下文中执行。
 * 支持：click、type、clear、select、focus、hover
 */
function iframeActionFunc(
  action: string,
  elementId: string,
  text: string,
  key: string,
): { success: boolean; message: string } {
  // 查找元素
  const el = document.querySelector(`[data-skeleton-id="${elementId}"]`) as HTMLElement | null
  if (!el) return { success: false, message: `未找到元素: ${elementId}` }

  function triggerClick(target: HTMLElement): void {
    const rect = target.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
  }

  function triggerType(target: HTMLElement, value: string): void {
    target.focus()
    target.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    // 使用原生 value setter 绕过框架拦截
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    if (descriptor?.set) {
      descriptor.set.call(target, value)
    } else {
      (target as HTMLInputElement).value = value
    }
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }

  try {
    switch (action) {
      case 'click': {
        triggerClick(el)
        return { success: true, message: '点击成功' }
      }
      case 'type': {
        triggerType(el, text)
        return { success: true, message: `输入成功: ${text}` }
      }
      case 'clear': {
        triggerType(el, '')
        return { success: true, message: '清空成功' }
      }
      case 'select': {
        (el as HTMLSelectElement).value = text
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return { success: true, message: `选择: ${text}` }
      }
      case 'focus': {
        el.focus()
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
        return { success: true, message: '聚焦成功' }
      }
      case 'hover': {
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: cx, clientY: cy }))
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, clientX: cx, clientY: cy }))
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }))
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: cx, clientY: cy }))
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }))
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }))
        return { success: true, message: '悬停成功' }
      }
      default:
        return { success: false, message: `iframe 不支持的操作: ${action}` }
    }
  } catch (err) {
    return { success: false, message: `操作异常: ${err instanceof Error ? err.message : String(err)}` }
  }
}
