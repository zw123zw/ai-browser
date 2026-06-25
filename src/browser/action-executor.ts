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

/** 检查元素是否可见（display:none / visibility:hidden / offsetParent） */
function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return el.offsetParent !== null || style.position === 'fixed'
}

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
    const needsElement = !['navigate', 'wait', 'scroll', 'keyboard', 'press', 'newTab', 'closeTab', 'switchTab', 'nextTab', 'prevTab', 'closeModal'].includes(cmd.action)
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
        case 'click':      result = await this.executeClick(element!); break
        case 'type':       result = await this.executeType(element!, cmd.text || ''); break
        case 'clear':      result = await this.executeClear(element!); break
        case 'scroll':     result = await this.executeScroll(cmd.direction || 'down', cmd.amount); break
        case 'navigate':   result = await this.executeNavigate(cmd.url || ''); break
        case 'select':     result = await this.executeSelect(element!, cmd.text || ''); break
        case 'keyboard':
        case 'press':      result = await this.executeKeyboard(cmd.key || ''); break
        case 'focus':      result = await this.executeFocus(element!); break
        case 'hover':      result = await this.executeHover(element!); break
        case 'wait':       result = await this.executeWait(cmd.ms || 1000, signal); break
        case 'newTab':     result = await this.executeTabAction('newTab'); break
        case 'closeTab':   result = await this.executeTabAction('closeTab'); break
        case 'switchTab':  result = await this.executeTabAction('switchTab', cmd.tabQuery || cmd.description); break
        case 'nextTab':    result = await this.executeTabAction('switchTab', 'next'); break
        case 'prevTab':    result = await this.executeTabAction('switchTab', 'prev'); break
        case 'video':      result = await this.executeVideo(element!, cmd.subAction || '', cmd.value); break
        case 'upload':     result = await this.executeUpload(element!, cmd.fileData, cmd); break
        case 'slider':     result = await this.executeSlider(element!, cmd.value); break
        case 'closeModal': result = await this.executeCloseModal(); break
        default:           result = { success: false, message: `未知操作类型: ${cmd.action}` }
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

  /**
   * 在 Shadow DOM 中递归查找元素
   *
   * CSS 选择器无法穿透 shadow boundary，
   * 需要手动遍历所有 shadowRoot 查找匹配的 data-skeleton-id。
   */
  private findInShadowDom(skeletonId: string): HTMLElement | null {
    const allElements = document.body.querySelectorAll('*')
    for (const el of allElements) {
      const htmlEl = el as HTMLElement
      if (htmlEl.shadowRoot) {
        const found = this.searchShadowRoot(htmlEl.shadowRoot, skeletonId, 1)
        if (found) return found
      }
    }
    return null
  }

  /** 递归搜索 shadowRoot 内的元素（最大 10 层深度） */
  private searchShadowRoot(shadowRoot: ShadowRoot, skeletonId: string, depth: number): HTMLElement | null {
    if (depth > 10) return null

    // 使用 CSS.escape 转义特殊字符，防止选择器注入
    const direct = shadowRoot.querySelector(`[data-skeleton-id="${CSS.escape(skeletonId)}"]`) as HTMLElement | null
    if (direct) return direct

    // 递归进入嵌套的 shadowRoot
    const allEls = shadowRoot.querySelectorAll('*')
    for (const el of allEls) {
      const htmlEl = el as HTMLElement
      if (htmlEl.shadowRoot) {
        const found = this.searchShadowRoot(htmlEl.shadowRoot, skeletonId, depth + 1)
        if (found) return found
      }
    }
    return null
  }

  private findElement(cmd: Command): HTMLElement | null {
    log.info('findElement 开始', { elementId: cmd.elementId, fallbackSelector: cmd.fallbackSelector, description: cmd.description })

    // 第一优先：elementId（骨架中的 id）
    if (cmd.elementId) {
      // 先在主文档中查找
      const el = document.querySelector(`[data-skeleton-id="${cmd.elementId}"]`)
      if (el) {
        log.info('findElement 通过 elementId 找到元素', { elementId: cmd.elementId, tag: el.tagName, className: (el as HTMLElement).className })
        return el as HTMLElement
      }

      // Shadow DOM 元素（sd 前缀）：在 shadowRoot 中递归查找
      if (cmd.elementId.startsWith('sd')) {
        const shadowEl = this.findInShadowDom(cmd.elementId)
        if (shadowEl) {
          log.info('findElement 通过 Shadow DOM 找到元素', { elementId: cmd.elementId, tag: shadowEl.tagName })
          return shadowEl
        }
      }

      log.warn('findElement elementId 未找到元素', { elementId: cmd.elementId })
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

  /**
   * 输入文本到编辑器
   *
   * 支持的编辑器类型：
   * - CodeMirror 5 (ByteMD / 掘金 / 各种 Markdown 编辑器)
   * - CodeMirror 6 (新一代编辑器)
   * - Monaco (代码编辑器)
   * - Ace (代码编辑器)
   * - Quill (.ql-editor)
   * - TinyMCE (.mce-content-body)
   * - CKEditor (.ck-editor)
   * - ProseMirror / TipTap (.ProseMirror)
   * - Draft.js (.DraftEditor-root)
   * - WangEditor (.w-e-text-container)
   * - 通用 contenteditable 元素
   * - 标准 input / textarea
   */
  private async executeType(el: HTMLElement, text: string): Promise<ActionResult> {
    el.focus()
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

    // ═══════════════════════════════════════════════════════
    // 1. 代码编辑器（CM5 / CM6 / Monaco / Ace）
    //    content script 隔离世界无法直接访问页面 JS 属性
    //    优先用 Clipboard paste 事件（通用可靠），兜底注入脚本
    // ═══════════════════════════════════════════════════════
    const isCodeEditor = !!el.closest('.CodeMirror, .cm-editor, .monaco-editor, .ace_editor')
    if (isCodeEditor) {
      // 方案 A：execCommand（最简单，部分编辑器支持）
      el.focus()
      const execOk = document.execCommand('insertText', false, text)
      if (execOk) {
        log.info('executeType execCommand 成功', { textLen: text.length })
        return { success: true, message: `输入成功: ${text.slice(0, 50)}...` }
      }

      // 方案 B：Clipboard API + paste 事件（通用兜底）
      try {
        const dt = new DataTransfer()
        dt.setData('text/plain', text)
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        })
        el.dispatchEvent(pasteEvent)
        log.info('executeType paste 事件已派发', { textLen: text.length })
        return { success: true, message: `输入成功: ${text.slice(0, 50)}...` }
      } catch {
        log.warn('executeType paste 事件失败，尝试脚本注入')
      }

      // 方案 C：注入脚本到页面上下文（最后兜底）
      const cmEl = el.closest('.CodeMirror')
      if (cmEl) {
        const escaped = JSON.stringify(text)
        const script = document.createElement('script')
        script.textContent = [
          `var c=document.querySelector('.CodeMirror')?.CodeMirror`,
          `if(c){c.setValue(${escaped});c.trigger?.('change')}`,
        ].join(';')
        document.head.appendChild(script)
        document.head.removeChild(script)
        log.info('executeType 脚本注入兜底', { textLen: text.length })
        return { success: true, message: `输入成功: ${text.slice(0, 50)}...` }
      }
    }

    // ═══════════════════════════════════════════════════════
    // 2. contenteditable 富文本编辑器
    //    Quill / TinyMCE / CKEditor / ProseMirror / TipTap /
    //    Draft.js / WangEditor / 通用 contenteditable
    //    document.execCommand 模拟用户输入，编辑器自然响应
    // ═══════════════════════════════════════════════════════
    const editableEl = el.isContentEditable
      ? el
      : el.closest('[contenteditable="true"]') as HTMLElement
    if (editableEl) {
      editableEl.focus()
      document.execCommand('selectAll', false, undefined)
      document.execCommand('insertText', false, text)
      log.info('executeType contenteditable', { tag: editableEl.tagName, className: editableEl.className })
      return { success: true, message: `输入成功: ${text.slice(0, 50)}...` }
    }

    // ═══════════════════════════════════════════════════════
    // 3. 标准 input / textarea
    // ═══════════════════════════════════════════════════════
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (nativeSetter) {
        nativeSetter.call(el, text)
      } else {
        el.value = text
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { success: true, message: `输入成功: ${text.slice(0, 50)}...` }
    }

    // ═══ 兜底 ═══
    log.warn('executeType 无法识别的编辑器', { tag: el.tagName, className: el.className, id: el.id })
    return { success: false, message: `无法识别的编辑器类型 (${el.tagName}.${el.className})，请尝试其他操作方式` }
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

  // ========== 文件上传 ==========

  /**
   * 上传文件到 <input type="file">
   *
   * 使用 DataTransfer API 将文件填入 file input，
   * 触发 change 事件使页面框架（React/Vue/Angular）检测到文件变化。
   *
   * 智能修正：
   * 1. 目标不是 file input → 自动查找组件内隐藏的 <input type="file">
   * 2. fileData 是字符串 → 自动包装为 { base64, name, mimeType } 结构
   */
  private async executeUpload(
    el: HTMLElement,
    fileData?: { base64: string; name: string; mimeType: string } | string,
    cmd?: Command,
  ): Promise<ActionResult> {
    // ═══ 智能定位：目标不是 file input 时，自动查找隐藏的 file input ═══
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
      const fileInput = this.findHiddenFileInput(el)
      if (fileInput) {
        log.info('upload 自动定位到隐藏的 file input', { originalTag: el.tagName, foundTag: fileInput.tagName })
        el = fileInput
      } else {
        return { success: false, message: '目标元素不是 file input，也未找到隐藏的文件选择框' }
      }
    }

    // ═══ 智能修正：fileData 格式自动转换 ═══
    let normalizedFileData: { base64: string; name: string; mimeType: string } | undefined

    if (fileData && typeof fileData === 'object') {
      // 正常格式：{ base64, name, mimeType }
      normalizedFileData = fileData
    } else if (fileData && typeof fileData === 'string') {
      // AI 错误格式：fileData 是纯文本或 data URL，name 从多个来源推断
      const name = cmd?.filename
        || extractFilenameFromDescription(cmd?.description)
        || 'upload.txt'
      const mimeType = guessMimeType(name)

      // 处理 data URL 格式（data:application/octet-stream;base64,...）
      let base64: string
      const dataUrlMatch = fileData.match(/^data:([^;]*);base64,(.+)$/)
      if (dataUrlMatch) {
        base64 = dataUrlMatch[2]
      } else {
        base64 = btoa(unescape(encodeURIComponent(fileData)))
      }

      normalizedFileData = { base64, name, mimeType }
      log.info('upload 自动修正 fileData 格式', { name, mimeType, contentLen: fileData.length, isDataUrl: !!dataUrlMatch })
    }

    if (!normalizedFileData) {
      return { success: false, message: '未提供文件数据（需 fileData: { base64, name, mimeType }）' }
    }

    try {
      // 聚焦元素（部分框架在 focus 时初始化上传状态）
      el.focus()
      el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

      // base64 padding 修正（避免缺少 = 号导致 atob 异常）
      const paddedBase64 = normalizedFileData.base64.padEnd(
        normalizedFileData.base64.length + (4 - normalizedFileData.base64.length % 4) % 4, '=',
      )

      // base64 解码为 ArrayBuffer
      const binaryStr = atob(paddedBase64)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
      }

      // 创建 File 对象并通过 DataTransfer 填入
      const file = new File([bytes], normalizedFileData.name, { type: normalizedFileData.mimeType })
      const dt = new DataTransfer()
      dt.items.add(file)
      const inputEl = el as HTMLInputElement
      inputEl.files = dt.files

      // 触发事件序列：input → change（覆盖各类框架的监听）
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))

      log.info('文件上传成功', { name: normalizedFileData.name, mimeType: normalizedFileData.mimeType, size: bytes.length })
      return { success: true, message: `文件已填入: ${normalizedFileData.name}` }
    } catch (error) {
      const msg = `文件上传失败: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg, error)
      return { success: false, message: msg }
    }
  }

  /**
   * 智能查找隐藏的 <input type="file">
   *
   * 框架上传组件（Element UI / Ant Design / Bootstrap）通常用按钮触发隐藏的 file input。
   * 查找策略：
   * 1. 目标元素自身是 file input → 直接返回
   * 2. 目标元素内部有 file input → 返回（如按钮内嵌 input）
   * 3. 目标元素的父组件内有 file input → 返回（如 Element UI el-upload）
   * 4. 全局查找隐藏的 file input → 返回第一个
   */
  private findHiddenFileInput(el: HTMLElement): HTMLInputElement | null {
    // 1. 自身就是 file input
    if (el instanceof HTMLInputElement && el.type === 'file') return el

    // 2. 目标元素内部有 file input
    const inner = el.querySelector('input[type="file"]') as HTMLInputElement | null
    if (inner) return inner

    // 3. 向上查找父组件（最多 5 层），找 file input
    let parent: HTMLElement | null = el.parentElement
    for (let i = 0; i < 5 && parent; i++) {
      const sibling = parent.querySelector('input[type="file"]') as HTMLInputElement | null
      if (sibling) return sibling
      parent = parent.parentElement
    }

    // 4. 全局查找隐藏的 file input（兜底）
    const allFileInputs = document.querySelectorAll('input[type="file"]')
    for (const input of allFileInputs) {
      const htmlInput = input as HTMLInputElement
      // 只选隐藏的（visible 的可能是用户手动操作的）
      if (!isElementVisible(htmlInput)) return htmlInput
    }

    return null
  }

  // ========== 滑块操作 ==========

  /**
   * 拖动滑块到指定值
   *
   * 支持标准 <input type="range"> 和自定义滑块（role="slider" + aria-valuemin/max）。
   * 模拟完整鼠标事件序列：mousedown → mousemove（多次）→ mouseup。
   */
  private async executeSlider(el: HTMLElement, targetValue?: number): Promise<ActionResult> {
    if (targetValue === undefined || targetValue === null) {
      return { success: false, message: '未指定目标值（需 value 字段）' }
    }

    // 标准 range input
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const min = parseFloat(el.min) || 0
      const max = parseFloat(el.max) || 100
      const step = parseFloat(el.step) || 1

      // 钳位到有效范围
      const clampedValue = Math.max(min, Math.min(max, targetValue))
      // 对齐到 step + 浮点精度修正
      const snappedValue = parseFloat((Math.round((clampedValue - min) / step) * step + min).toFixed(10))

      // 设置值
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (nativeSetter) {
        nativeSetter.call(el, String(snappedValue))
      } else {
        el.value = String(snappedValue)
      }

      // 触发事件序列
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))

      log.info('滑块设置成功', { value: snappedValue, min, max, step })
      return { success: true, message: `滑块已设为: ${snappedValue}` }
    }

    // 自定义滑块（role="slider"）
    const role = el.getAttribute('role')
    if (role === 'slider') {
      const min = parseFloat(el.getAttribute('aria-valuemin') || '0') || 0
      const max = parseFloat(el.getAttribute('aria-valuemax') || '100') || 100
      const clampedValue = Math.max(min, Math.min(max, targetValue))

      // 除零保护：max === min 时 ratio 为 NaN
      const range = max - min
      if (range === 0) {
        el.setAttribute('aria-valuenow', String(min))
        return { success: true, message: `滑块已设为: ${min}` }
      }

      // 获取元素位置，计算目标像素位置
      const rect = el.getBoundingClientRect()
      const targetRatio = (clampedValue - min) / range
      const targetX = rect.left + rect.width * targetRatio
      const targetY = rect.top + rect.height / 2

      // 起点基于 aria-valuenow 计算当前位置（而非默认元素中心）
      const currentValue = parseFloat(el.getAttribute('aria-valuenow') || String(min))
      const startRatio = (Math.max(min, Math.min(max, currentValue)) - min) / range
      const startX = rect.left + rect.width * startRatio
      const startY = rect.top + rect.height / 2

      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }))
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }))

      // 分步移动（模拟真实拖拽）
      const steps = 5
      for (let i = 1; i <= steps; i++) {
        const x = startX + (targetX - startX) * (i / steps)
        const y = startY + (targetY - startY) * (i / steps)
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      }

      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: targetX, clientY: targetY }))
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: targetX, clientY: targetY }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: targetX, clientY: targetY }))

      // 浮点精度修正 + 更新 aria-valuenow + 触发事件通知框架
      const snappedValue = parseFloat(clampedValue.toFixed(10))
      el.setAttribute('aria-valuenow', String(snappedValue))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('input', { bubbles: true }))

      log.info('自定义滑块操作成功', { value: snappedValue, min, max })
      return { success: true, message: `滑块已拖到: ${snappedValue}` }
    }

    return { success: false, message: '目标元素不是滑块（需 input[type=range] 或 role=slider）' }
  }

  // ========== 弹窗关闭 ==========

  /**
   * 关闭页面弹窗/对话框
   *
   * 扫描策略（按优先级）：
   * 1. 原生 dialog[open] → 调用 dialog.close()
   * 2. ARIA dialog → 查找关闭按钮
   * 3. 框架弹窗（Bootstrap/Element UI/Ant Design）→ 查找关闭按钮
   * 4. 通用遮罩 → 查找固定定位元素内的关闭/取消按钮
   * 循环关闭直到无弹窗（最多 10 层）。
   */
  private async executeCloseModal(): Promise<ActionResult> {
    let closedCount = 0
    const maxRounds = 10

    for (let round = 0; round < maxRounds; round++) {
      let closed = false

      // 0. 尝试 Escape 键关闭（最常见的弹窗关闭方式）
      if (round === 0) {
        // 记录 Escape 前所有可见的弹窗相关元素
        const modalSelector = 'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .el-dialog__wrapper, .ant-modal-wrap, .MuiDialog-root, .v-dialog, [class*="overlay"], [class*="mask"], [class*="modal-backdrop"], [class*="dialog"]'
        const visibleBefore = Array.from(document.querySelectorAll(modalSelector))
          .filter(el => isElementVisible(el as HTMLElement))

        const activeEl = document.activeElement || document.body
        activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
        activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
        // 等待足够时间让 Escape 生效和关闭动画完成
        await new Promise(resolve => setTimeout(resolve, 300))

        // 检查之前可见的弹窗：已从 DOM 移除 或 不再可见
        let closedByEscape = 0
        for (const el of visibleBefore) {
          if (!el.isConnected || !isElementVisible(el as HTMLElement)) closedByEscape++
        }
        if (closedByEscape > 0) {
          closedCount += closedByEscape
          closed = true
          log.info('Escape 关闭了弹窗', { closedByEscape })
        }
      }

      // 1. 原生 dialog[open]
      const dialogs = document.querySelectorAll('dialog[open]')
      for (const dialog of dialogs) {
        (dialog as HTMLDialogElement).close()
        closed = true
        closedCount++
        log.info('关闭原生 dialog')
      }

      // 2. ARIA dialog/alertdialog → 查找关闭按钮
      const ariaDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
      for (const dialog of ariaDialogs) {
        if (!isElementVisible(dialog as HTMLElement)) continue
        const closeBtn = this.findCloseButton(dialog as HTMLElement)
        if (closeBtn) {
          this.triggerClick(closeBtn)
          closed = true
          closedCount++
          log.info('关闭 ARIA 弹窗')
        }
      }

      // 3. 常见框架弹窗
      const frameworkSelectors = [
        '.modal.show',                    // Bootstrap
        '.el-dialog__wrapper',            // Element UI
        '.ant-modal-wrap',                // Ant Design
        '.MuiDialog-root',               // Material UI
        '.v-dialog--active',              // Vuetify
      ]
      for (const sel of frameworkSelectors) {
        const els = document.querySelectorAll(sel)
        for (const el of els) {
          if (!isElementVisible(el as HTMLElement)) continue
          const closeBtn = this.findCloseButton(el as HTMLElement)
          if (closeBtn) {
            this.triggerClick(closeBtn)
            closed = true
            closedCount++
            log.info('关闭框架弹窗', { selector: sel })
          }
        }
      }

      // 4. 通用遮罩层内的关闭/取消按钮
      const overlaySelectors = [
        '[class*="overlay"]',
        '[class*="mask"]',
        '[class*="modal-backdrop"]',
        '[class*="dialog-mask"]',
      ]
      for (const sel of overlaySelectors) {
        const els = document.querySelectorAll(sel)
        for (const el of els) {
          const htmlEl = el as HTMLElement
          if (!isElementVisible(htmlEl)) continue
          const rect = htmlEl.getBoundingClientRect()
          if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
            const closeBtn = this.findCloseButton(htmlEl)
            if (closeBtn) {
              this.triggerClick(closeBtn)
              closed = true
              closedCount++
              log.info('关闭遮罩弹窗')
            }
          }
        }
      }

      // 本轮没有关闭任何弹窗 → 退出循环
      if (!closed) break

      // 等待 200ms 让弹窗关闭动画完成（避免动画期间误判）
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    if (closedCount > 0) {
      return { success: true, message: `已关闭 ${closedCount} 个弹窗` }
    }
    return { success: false, message: '未检测到弹窗' }
  }

  /**
   * 在容器内查找关闭按钮
   *
   * 查找策略：
   * 1. aria-label 含 close/close/dismiss/关闭/取消
   * 2. class 含 close
   * 3. 文字为 ×/✕/关闭/取消/知道了/确定/完成/好/Done/Close
   * 自动跳过 disabled 按钮
   */
  private findCloseButton(container: HTMLElement): HTMLElement | null {
    // 1. aria-label 含 close/dismiss/关闭/取消
    const ariaClose = container.querySelector(
      '[aria-label*="close" i], [aria-label*="dismiss" i], [aria-label*="关闭"], [aria-label*="取消"]',
    ) as HTMLElement | null
    if (ariaClose && this.isButtonEnabled(ariaClose)) return ariaClose

    // 2. class 含 close（排除非按钮元素）
    const classClose = container.querySelector(
      '.close, .btn-close, [class*="close-btn"], [class*="close-icon"], [class*="modal-close"]',
    ) as HTMLElement | null
    if (classClose && isElementVisible(classClose) && this.isButtonEnabled(classClose)) return classClose

    // 3. 文字匹配
    const closeTexts = ['×', '✕', '✕', '关闭', '取消', '知道了', '确定', '完成', '好', 'OK', 'ok', 'Done', 'Close']
    const buttons = container.querySelectorAll('button, [role="button"], a, span')
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || ''
      if (closeTexts.includes(text) && isElementVisible(btn as HTMLElement) && this.isButtonEnabled(btn as HTMLElement)) {
        return btn as HTMLElement
      }
    }

    return null
  }

  /** 检查按钮是否可用（未 disabled） */
  private isButtonEnabled(el: HTMLElement): boolean {
    if ((el as HTMLButtonElement).disabled) return false
    if (el.getAttribute('aria-disabled') === 'true') return false
    return true
  }
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

/** 从 AI 的 description 中提取文件名（如"上传.travis.yml文件到..." → ".travis.yml"） */
function extractFilenameFromDescription(desc?: string): string | undefined {
  if (!desc) return undefined
  // 匹配常见文件名模式：xxx.xxx 或 .xxx
  const match = desc.match(/([\w.-]+\.\w{1,10})/)
  return match?.[1]
}

/** 根据文件扩展名猜测 MIME 类型 */
function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    // 文本
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html',
    css: 'text/css', xml: 'text/xml', yml: 'text/yaml', yaml: 'text/yaml',
    // 脚本
    js: 'application/javascript', ts: 'application/javascript', json: 'application/json',
    py: 'text/x-python', rb: 'text/x-ruby', java: 'text/x-java', c: 'text/x-c', cpp: 'text/x-c++',
    // 文档
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // 图片
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
    // 压缩
    zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', rar: 'application/vnd.rar',
    // 音视频
    mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo',
  }
  return map[ext] || 'application/octet-stream'
}
