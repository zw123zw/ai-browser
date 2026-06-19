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

export class ActionExecutor {
  /**
   * 执行单条指令
   */
  async execute(cmd: Command): Promise<ActionResult> {
    log.info('═══ 执行指令开始 ═══', { action: cmd.action, elementId: cmd.elementId, description: cmd.description })

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
        case 'wait':      result = await this.executeWait(cmd.ms || 1000); break
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

  /** 触发点击事件：完整的鼠标事件序列（mousedown → focus → mouseup → click） */
  private triggerClick(el: HTMLElement): void {
    log.info('triggerClick 开始', { tag: el.tagName, className: el.className, id: el.id })
    const rect = el.getBoundingClientRect()
    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
    }

    // 完整事件序列：模拟真实用户点击
    // Element UI 的 Select/DatePicker 等组件监听 mousedown/focus，仅 el.click() 无法触发
    el.dispatchEvent(new MouseEvent('mousedown', eventInit))
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
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
}

/** 格式化时间为 mm:ss */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
