/**
 * 浏览器指令执行引擎
 *
 * 三重元素定位：elementId → fallbackSelector → 文本匹配
 * 完整事件触发序列（非简单 .click()）
 */

import { Logger } from '@/src/utils/logger'
import type { Command, ActionResult } from './types'

const log = new Logger('ActionExecutor')

export class ActionExecutor {
  /**
   * 执行单条指令
   */
  async execute(cmd: Command): Promise<ActionResult> {
    log.info('执行指令', { action: cmd.action, elementId: cmd.elementId, description: cmd.description })

    // 不需要元素的操作（keyboard/press 作用于当前焦点元素，tab 操作走 background）
    const needsElement = !['navigate', 'wait', 'scroll', 'keyboard', 'press', 'newTab', 'closeTab', 'switchTab', 'nextTab', 'prevTab'].includes(cmd.action)
    let element: HTMLElement | null = null

    if (needsElement) {
      element = this.findElement(cmd)
      if (!element) {
        const msg = `未找到目标元素: ${cmd.description || cmd.elementId || cmd.action}`
        log.warn(msg)
        return { success: false, message: msg }
      }
    }

    try {
      switch (cmd.action) {
        case 'click':     return await this.executeClick(element!)
        case 'type':      return await this.executeType(element!, cmd.text || '')
        case 'clear':     return await this.executeClear(element!)
        case 'scroll':    return await this.executeScroll(cmd.direction || 'down', cmd.amount)
        case 'navigate':  return await this.executeNavigate(cmd.url || '')
        case 'select':    return await this.executeSelect(element!, cmd.text || '')
        case 'keyboard':
        case 'press':     return await this.executeKeyboard(cmd.key || '')
        case 'focus':     return await this.executeFocus(element!)
        case 'hover':     return await this.executeHover(element!)
        case 'wait':      return await this.executeWait(cmd.ms || 1000)
        case 'newTab':    return await this.executeTabAction('newTab')
        case 'closeTab':  return await this.executeTabAction('closeTab')
        case 'switchTab': return await this.executeTabAction('switchTab', cmd.tabQuery || cmd.description)
        case 'nextTab':   return await this.executeTabAction('switchTab', 'next')
        case 'prevTab':   return await this.executeTabAction('switchTab', 'prev')
        default:          return { success: false, message: `未知操作类型: ${cmd.action}` }
      }
    } catch (error) {
      const msg = `执行异常: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg, error)
      return { success: false, message: msg }
    }
  }

  // ========== 三重元素定位 ==========

  private findElement(cmd: Command): HTMLElement | null {
    // 第一优先：elementId（骨架中的 id）
    if (cmd.elementId) {
      const el = document.querySelector(`[data-skeleton-id="${cmd.elementId}"]`)
      if (el) {
        log.debug('通过 elementId 找到元素', { elementId: cmd.elementId })
        return el as HTMLElement
      }
    }

    // 第二优先：fallbackSelector（CSS 选择器）
    if (cmd.fallbackSelector) {
      try {
        const el = document.querySelector(cmd.fallbackSelector)
        if (el) {
          log.debug('通过 fallbackSelector 找到元素', { selector: cmd.fallbackSelector })
          return el as HTMLElement
        }
      } catch {
        // 无效选择器，跳过
      }
    }

    // 第三优先：文本内容匹配
    if (cmd.description) {
      const el = this.findByText(cmd.description)
      if (el) {
        log.debug('通过文本匹配找到元素', { text: cmd.description })
        return el
      }
    }

    return null
  }

  /** 文本模糊匹配查找元素 */
  private findByText(text: string): HTMLElement | null {
    // 优先搜索交互元素
    const interactive = document.querySelectorAll('a, button, input, select, [role="button"], [onclick], [tabindex]')
    for (const el of interactive) {
      const elText = el.textContent?.trim() || ''
      const ariaLabel = el.getAttribute('aria-label') || ''
      const title = el.getAttribute('title') || ''
      if (elText.includes(text) || ariaLabel.includes(text) || title.includes(text)) {
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
      if (elText.includes(text) || ariaLabel.includes(text) || title.includes(text)) {
        // 过滤不可见元素
        const style = window.getComputedStyle(el as HTMLElement)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        return el as HTMLElement
      }
    }

    return null
  }

  // ========== 操作执行 ==========

  /** 点击：触发完整鼠标事件序列 */
  private async executeClick(el: HTMLElement): Promise<ActionResult> {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    const mouseEventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }

    el.dispatchEvent(new MouseEvent('mousedown', mouseEventInit))
    el.dispatchEvent(new MouseEvent('mouseup', mouseEventInit))

    // <a> 标签：区分真实链接 vs JS 交互型链接
    if (el instanceof HTMLAnchorElement) {
      const href = el.getAttribute('href') || ''
      if (!href || href === '#' || href.startsWith('javascript:')) {
        // javascript: / # / 空 href → 依赖 JS 事件处理器，触发 click 事件
        el.dispatchEvent(new MouseEvent('click', mouseEventInit))
      } else if (el.href) {
        // 真实 URL → 新标签页打开（保留原 target 指定的行为）
        const target = el.target || '_blank'
        const opened = window.open(el.href, target)
        if (!opened) window.location.href = el.href
      }
    } else {
      el.dispatchEvent(new MouseEvent('click', mouseEventInit))
    }

    return { success: true, message: '点击成功' }
  }

  /** 输入：focus → 设置值 → 触发 input/change 事件（兼容 React/Vue） */
  private async executeType(el: HTMLElement, text: string): Promise<ActionResult> {
    el.focus()
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

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

  /** 滚动 */
  private async executeScroll(direction: string, amount?: number): Promise<ActionResult> {
    const scrollAmount = amount || window.innerHeight * 0.8
    switch (direction) {
      case 'up':     window.scrollBy(0, -scrollAmount); break
      case 'down':   window.scrollBy(0, scrollAmount); break
      case 'top':    window.scrollTo(0, 0); break
      case 'bottom': window.scrollTo(0, document.body.scrollHeight); break
      default:       return { success: false, message: `未知滚动方向: ${direction}` }
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

    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }))
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }))

    return { success: true, message: '悬停成功' }
  }

  /** 等待 */
  private async executeWait(ms: number): Promise<ActionResult> {
    await new Promise(resolve => setTimeout(resolve, ms))
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
}
