/**
 * 划词翻译浮层弹窗
 *
 * 选中文本后在选区附近显示翻译结果。
 * 纯 DOM 实现（不依赖 Vue），轻量且独立于 Shadow DOM。
 *
 * 流程：
 * 1. 选中文本 → showTranslateLoading() 显示浮层 + loading
 * 2. AI 返回 → updateTranslateResult() 替换为译文
 *
 * 功能：
 * - loading 状态动画
 * - 显示译文 + 原文对照
 * - 复制按钮
 * - 关闭按钮
 * - 点击外部自动关闭
 * - 页面滚动时关闭
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('TranslatePopup')

/** 当前弹窗实例（单例） */
let currentPopup: HTMLElement | null = null
/** 内容区元素引用（用于更新译文） */
let contentEl: HTMLElement | null = null
/** loading 区元素引用 */
let loadingEl: HTMLElement | null = null
/** 工具栏区引用 */
let toolbarEl: HTMLElement | null = null
/** 当前原文（用于复制） */
let currentTranslated = ''
/** 外部点击关闭的处理器 */
let clickOutsideHandler: ((e: MouseEvent) => void) | null = null
/** 滚动关闭的处理器 */
let scrollHandler: (() => void) | null = null

/** 弹窗最大宽度 */
const MAX_WIDTH = 400
/** 弹窗与选区的间距 */
const OFFSET = 8

/**
 * 显示翻译浮层（loading 状态）
 *
 * 选中文本后立即调用，底部显示 loading 动画。
 * 翻译完成后调用 updateTranslateResult() 更新内容。
 *
 * @param x - 触发点 X 坐标（clientX）
 * @param y - 触发点 Y 坐标（clientY）
 * @param original - 原始文本
 */
export function showTranslateLoading(x: number, y: number, original: string): void {
  hideTranslatePopup()

  const popup = document.createElement('div')
  popup.className = 'zwf-translate-popup'
  popup.setAttribute('translate', 'no')

  Object.assign(popup.style, {
    position: 'fixed',
    zIndex: '2147483647',
    maxWidth: `${MAX_WIDTH}px`,
    minWidth: '120px',
    padding: '10px 14px',
    background: '#1a1a2e',
    color: '#e0e0e0',
    borderRadius: '10px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    fontSize: '14px',
    lineHeight: '1.6',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    transition: 'opacity 0.15s ease',
    opacity: '0',
    pointerEvents: 'auto',
  })

  // 内容区（初始为空，等翻译结果）
  const content = document.createElement('div')
  content.style.marginBottom = '6px'
  content.style.minHeight = '20px'
  contentEl = content
  popup.appendChild(content)

  // 原文
  const origEl = document.createElement('div')
  Object.assign(origEl.style, {
    fontSize: '12px',
    color: '#888',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    paddingTop: '6px',
    marginTop: '4px',
  })
  origEl.textContent = original
  popup.appendChild(origEl)

  // loading 区
  const loading = document.createElement('div')
  Object.assign(loading.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '8px',
    paddingTop: '6px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    fontSize: '12px',
    color: '#888',
  })

  // loading 动画点
  const dots = document.createElement('span')
  dots.textContent = '翻译中'
  Object.assign(dots.style, { letterSpacing: '1px' })

  const animDots = document.createElement('span')
  animDots.className = 'zwf-translate-dots'
  Object.assign(animDots.style, {
    display: 'inline-block',
    width: '20px',
    textAlign: 'left',
  })
  animDots.textContent = '...'

  // CSS 动画
  const style = document.createElement('style')
  style.textContent = `
    @keyframes zwf-dot-blink {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
    .zwf-translate-dots::after {
      content: '...';
      animation: zwf-dot-blink 1.2s infinite steps(3, end);
    }
    .zwf-translate-dots { font-size: 0; }
    .zwf-translate-dots::after { font-size: 12px; }
  `
  popup.appendChild(style)

  loading.appendChild(dots)
  loading.appendChild(animDots)
  loadingEl = loading
  popup.appendChild(loading)

  // 工具栏（初始隐藏，翻译完成后显示）
  const toolbar = document.createElement('div')
  Object.assign(toolbar.style, {
    display: 'none',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '8px',
    paddingTop: '6px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
  })
  toolbarEl = toolbar
  popup.appendChild(toolbar)

  document.body.appendChild(popup)
  currentPopup = popup

  positionPopup(popup, x, y)

  requestAnimationFrame(() => {
    popup.style.opacity = '1'
  })

  // 点击外部关闭
  setTimeout(() => {
    clickOutsideHandler = (e: MouseEvent) => {
      if (currentPopup && !currentPopup.contains(e.target as Node)) {
        hideTranslatePopup()
      }
    }
    document.addEventListener('mousedown', clickOutsideHandler)
  }, 100)

  // 滚动时关闭
  scrollHandler = () => hideTranslatePopup()
  window.addEventListener('scroll', scrollHandler, { passive: true })

  log.debug('翻译弹窗 loading 已显示', { x, y, original: original.slice(0, 30) })
}

/**
 * 更新翻译结果（AI 返回后调用）
 *
 * 替换 loading 为译文，显示工具栏。
 */
export function updateTranslateResult(translated: string): void {
  if (!currentPopup) return

  currentTranslated = translated

  // 更新内容区
  if (contentEl) {
    contentEl.textContent = translated
  }

  // 隐藏 loading
  if (loadingEl) {
    loadingEl.style.display = 'none'
  }

  // 显示工具栏
  if (toolbarEl) {
    toolbarEl.style.display = 'flex'
    toolbarEl.innerHTML = ''

    // 复制按钮
    const copyBtn = createToolButton('复制', () => {
      navigator.clipboard.writeText(translated).then(() => {
        copyBtn.textContent = '已复制'
        setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
      }).catch(() => {
        log.warn('复制失败')
      })
    })
    toolbarEl.appendChild(copyBtn)
  }

  // 重新定位（内容高度变化后可能溢出）
  if (currentPopup) {
    const rect = currentPopup.getBoundingClientRect()
    positionPopup(currentPopup, parseFloat(currentPopup.style.left), parseFloat(currentPopup.style.top) - OFFSET)
  }

  log.debug('翻译结果已更新', { translated: translated.slice(0, 30) })
}

/**
 * 显示翻译错误（AI 调用失败时调用）
 *
 * 替换 loading 为错误提示，显示刷新 + 关闭按钮。
 *
 * @param message - 错误提示
 * @param onRetry - 点击刷新按钮的回调
 */
export function updateTranslateError(message: string, onRetry?: () => void): void {
  if (!currentPopup) return

  // 更新内容区为错误提示
  if (contentEl) {
    contentEl.textContent = message
    contentEl.style.color = 'var(--zwf-text-soft, #888)'
    contentEl.style.fontSize = '13px'
  }

  // 隐藏 loading
  if (loadingEl) {
    loadingEl.style.display = 'none'
  }

  // 显示工具栏：刷新 + 关闭
  if (toolbarEl) {
    toolbarEl.style.display = 'flex'
    toolbarEl.innerHTML = ''

    if (onRetry) {
      const retryBtn = createToolButton('刷新', () => {
        // 恢复 loading 状态
        if (contentEl) {
          contentEl.textContent = ''
          contentEl.style.color = ''
          contentEl.style.fontSize = ''
          contentEl.style.display = 'none'
        }
        if (loadingEl) loadingEl.style.display = ''
        toolbarEl.style.display = 'none'
        onRetry()
      })
      toolbarEl.appendChild(retryBtn)
    }

    const closeBtn = createToolButton('关闭', () => hideTranslatePopup())
    toolbarEl.appendChild(closeBtn)
  }

  // 重新定位
  if (currentPopup) {
    positionPopup(currentPopup, parseFloat(currentPopup.style.left), parseFloat(currentPopup.style.top) - OFFSET)
  }

  log.debug('翻译错误已显示', { message })
}

/**
 * 显示翻译浮层（直接显示译文，无 loading 阶段）
 *
 * 用于翻译已完成的场景。
 */
export function showTranslatePopup(
  x: number,
  y: number,
  translated: string,
  original?: string,
): void {
  showTranslateLoading(x, y, original || '')
  updateTranslateResult(translated)
}

/**
 * 隐藏翻译浮层
 */
export function hideTranslatePopup(): void {
  if (currentPopup) {
    currentPopup.remove()
    currentPopup = null
  }
  contentEl = null
  loadingEl = null
  toolbarEl = null
  currentTranslated = ''
  if (clickOutsideHandler) {
    document.removeEventListener('mousedown', clickOutsideHandler)
    clickOutsideHandler = null
  }
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler)
    scrollHandler = null
  }
}

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

/** 定位弹窗（确保不超出视口） */
function positionPopup(popup: HTMLElement, x: number, y: number): void {
  // 先用临时定位测量尺寸
  popup.style.left = '0px'
  popup.style.top = '0px'
  const rect = popup.getBoundingClientRect()
  const vpWidth = window.innerWidth
  const vpHeight = window.innerHeight

  let left = x
  let top = y + OFFSET

  if (left + rect.width > vpWidth - 12) {
    left = vpWidth - rect.width - 12
  }
  if (left < 12) left = 12
  if (top + rect.height > vpHeight - 12) {
    top = y - rect.height - OFFSET
  }
  if (top < 12) top = 12

  popup.style.left = `${left}px`
  popup.style.top = `${top}px`
}

/** 创建工具栏按钮 */
function createToolButton(text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = text
  Object.assign(btn.style, {
    padding: '2px 10px',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '6px',
    background: 'rgba(255,255,255,0.08)',
    color: '#ccc',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s ease',
  })
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(255,255,255,0.15)'
    btn.style.color = '#fff'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(255,255,255,0.08)'
    btn.style.color = '#ccc'
  })
  btn.addEventListener('click', onClick)
  return btn
}
