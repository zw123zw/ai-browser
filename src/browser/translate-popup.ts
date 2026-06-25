/**
 * 划词翻译/笔记浮层弹窗
 *
 * 选中文本后在选区附近显示翻译结果和/或笔记结果。
 * 纯 DOM 实现（不依赖 Vue），轻量且独立于 Shadow DOM。
 *
 * 流程：
 * 1. 选中文本 → showTranslateLoading() 显示浮层 + loading
 * 2. AI 返回 → updateTranslateResult() 替换为译文
 * 3. AI 返回 → updateNoteResult() 替换为笔记（可选，与翻译合并显示）
 *
 * 功能：
 * - loading 状态动画
 * - 显示译文 + 原文对照
 * - 显示笔记 AI 优化内容（可选）
 * - 复制按钮（翻译模式）
 * - 收藏笔记按钮（笔记模式）
 * - 关闭按钮
 * - 点击外部自动关闭
 * - 页面滚动时关闭
 */

import { renderMarkdownPlain } from '@/src/utils/markdown'
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
/** 笔记内容区引用 */
let noteContentEl: HTMLElement | null = null
/** 当前译文（用于复制） */
let currentTranslated = ''
/** 当前笔记内容（用于收藏） */
let currentNoteContent = ''
/** 原始触发坐标（用于重新定位） */
let originX = 0
let originY = 0

/** 弹窗最大宽度 */
const MAX_WIDTH = 450
/** 弹窗与选区的间距 */
const OFFSET = 8

/**
 * 显示浮层（loading 状态）
 *
 * 选中文本后立即调用，底部显示 loading 动画。
 * 翻译/笔记完成后调用 updateTranslateResult() / updateNoteResult() 更新内容。
 *
 * @param x - 触发点 X 坐标（clientX）
 * @param y - 触发点 Y 坐标（clientY）
 * @param original - 原始文本
 */
export function showTranslateLoading(x: number, y: number, original: string): void {
  hideTranslatePopup()

  const popup = document.createElement('div')
  popup.className = 'aib-translate-popup'
  popup.setAttribute('translate', 'no')

  Object.assign(popup.style, {
    position: 'absolute',
    zIndex: '2147483647',
    maxWidth: `${MAX_WIDTH}px`,
    minWidth: '120px',
    maxHeight: '70vh',
    overflowY: 'auto',
    padding: '10px 14px',
    paddingTop: '28px', // 为关闭按钮留空间
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

  // 关闭按钮（右上角）
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '6px',
    right: '8px',
    width: '20px',
    height: '20px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: '#888',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    lineHeight: '1',
  })
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; closeBtn.style.background = 'rgba(255,255,255,0.1)' })
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#888'; closeBtn.style.background = 'transparent' })
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); hideTranslatePopup() })
  popup.appendChild(closeBtn)

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

  // 笔记内容区（初始隐藏，笔记完成后显示）
  const noteSection = document.createElement('div')
  Object.assign(noteSection.style, {
    display: 'none',
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid rgba(255,255,255,0.15)',
  })
  const noteLabel = document.createElement('div')
  noteLabel.textContent = '📝 AI 笔记'
  Object.assign(noteLabel.style, {
    fontSize: '11px',
    color: '#8b5cf6',
    marginBottom: '4px',
    fontWeight: '600',
  })
  noteSection.appendChild(noteLabel)
  const noteContent = document.createElement('div')
  Object.assign(noteContent.style, {
    fontSize: '13px',
    lineHeight: '1.6',
    color: '#d0d0d0',
    whiteSpace: 'normal', // markdown 渲染用 HTML 控制空白
  })
  // markdown 渲染样式（暗色主题优化）
  const noteStyle = document.createElement('style')
  noteStyle.textContent = `
    .aib-note-md { color: #d4d4d8; font-size: 13px; line-height: 1.7; }
    .aib-note-md h1,.aib-note-md h2,.aib-note-md h3,.aib-note-md h4 {
      margin: 8px 0 4px; font-weight: 600; color: #f4f4f5;
    }
    .aib-note-md h1 { font-size: 15px; color: #a78bfa; border-bottom: 1px solid rgba(167,139,250,0.2); padding-bottom: 4px; }
    .aib-note-md h2 { font-size: 14px; color: #c4b5fd; }
    .aib-note-md h3 { font-size: 13px; color: #ddd6fe; }
    .aib-note-md h4 { font-size: 12px; color: #ede9fe; }
    .aib-note-md p { margin: 4px 0; }
    .aib-note-md ul,.aib-note-md ol { margin: 4px 0; padding-left: 18px; }
    .aib-note-md li { margin: 2px 0; }
    .aib-note-md li::marker { color: #a78bfa; }
    .aib-note-md strong { color: #fbbf24; font-weight: 600; }
    .aib-note-md em { color: #93c5fd; font-style: italic; }
    .aib-note-md a { color: #60a5fa; text-decoration: none; }
    .aib-note-md a:hover { text-decoration: underline; }
    .aib-note-md code {
      background: rgba(139,92,246,0.15); color: #c4b5fd; padding: 1px 5px; border-radius: 4px; font-size: 12px;
    }
    .aib-note-md pre {
      background: rgba(0,0,0,0.4); padding: 10px 12px; border-radius: 8px; overflow-x: auto; margin: 6px 0;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .aib-note-md pre code { background: none; color: #d4d4d8; padding: 0; }
    .aib-note-md blockquote {
      border-left: 3px solid #a78bfa; margin: 6px 0; padding: 4px 12px;
      color: #a1a1aa; background: rgba(139,92,246,0.06); border-radius: 0 6px 6px 0;
    }
    .aib-note-md table { border-collapse: collapse; width: 100%; margin: 6px 0; }
    .aib-note-md th {
      background: rgba(139,92,246,0.12); color: #c4b5fd; font-weight: 600;
      border: 1px solid rgba(139,92,246,0.2); padding: 6px 10px; font-size: 12px; text-align: left;
    }
    .aib-note-md td {
      border: 1px solid rgba(255,255,255,0.08); padding: 5px 10px; font-size: 12px;
    }
    .aib-note-md tr:nth-child(even) { background: rgba(255,255,255,0.02); }
    .aib-note-md hr { border: none; border-top: 1px solid rgba(139,92,246,0.2); margin: 10px 0; }
    .aib-note-md img { max-width: 100%; border-radius: 6px; }
  `
  noteContent.appendChild(noteStyle)
  noteContent.className = 'aib-note-md'
  noteSection.appendChild(noteContent)
  noteContentEl = noteSection
  popup.appendChild(noteSection)

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
  dots.textContent = '处理中'
  Object.assign(dots.style, { letterSpacing: '1px' })

  const animDots = document.createElement('span')
  animDots.className = 'aib-translate-dots'
  Object.assign(animDots.style, {
    display: 'inline-block',
    width: '20px',
    textAlign: 'left',
  })
  animDots.textContent = '...'

  // CSS 动画 + 滚动条样式
  const style = document.createElement('style')
  style.textContent = `
    @keyframes aib-dot-blink {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
    .aib-translate-dots::after {
      content: '...';
      animation: aib-dot-blink 1.2s infinite steps(3, end);
    }
    .aib-translate-dots { font-size: 0; }
    .aib-translate-dots::after { font-size: 12px; }
    .aib-translate-popup::-webkit-scrollbar { width: 4px; }
    .aib-translate-popup::-webkit-scrollbar-track { background: transparent; }
    .aib-translate-popup::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
    .aib-translate-popup::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
  `
  popup.appendChild(style)

  loading.appendChild(dots)
  loading.appendChild(animDots)
  loadingEl = loading
  popup.appendChild(loading)

  // 工具栏（初始隐藏，翻译/笔记完成后显示）
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

  originX = x
  originY = y
  positionPopup(popup, x, y)

  requestAnimationFrame(() => {
    popup.style.opacity = '1'
  })

  log.debug('浮层 loading 已显示', { x, y, original: original.slice(0, 30) })
}

/**
 * 更新翻译结果（AI 返回后调用）
 *
 * 替换 loading 为译文，显示工具栏。
 *
 * @param translated - 翻译后的文本
 * @param onCopy - 可选，自定义复制回调（默认复制 translated）
 */
export function updateTranslateResult(translated: string, onCopy?: () => void): void {
  if (!currentPopup) return

  currentTranslated = translated

  // 更新内容区（恢复 display，可能被重试按钮隐藏）
  if (contentEl) {
    contentEl.style.display = ''
    contentEl.style.color = ''
    contentEl.style.fontSize = ''
    contentEl.textContent = translated
  }

  // 隐藏 loading
  if (loadingEl) {
    loadingEl.style.display = 'none'
  }

  // 始终重建工具栏（确保翻译和笔记按钮状态正确）
  showToolbar()

  // 重新定位（内容高度变化后可能溢出）
  if (currentPopup) {
    positionPopup(currentPopup, originX, originY)
  }

  log.debug('翻译结果已更新', { translated: translated.slice(0, 30) })
}

/**
 * 更新笔记结果（笔记 AI 返回后调用）
 *
 * @param noteContent - 笔记 markdown 内容
 * @param onBookmark - 收藏回调
 */
export function updateNoteResult(noteContent: string, onBookmark: (content: string) => void): void {
  if (!currentPopup) return

  currentNoteContent = noteContent

  // 显示笔记内容区
  if (noteContentEl) {
    noteContentEl.style.display = 'block'
    // 用 markdown 渲染笔记内容（纯预览，无复制/下载按钮）
    const contentDiv = noteContentEl.querySelector('div:last-child') as HTMLElement
    if (contentDiv) {
      contentDiv.innerHTML = renderMarkdownPlain(noteContent)
    }
  }

  // 隐藏 loading
  if (loadingEl) {
    loadingEl.style.display = 'none'
  }

  // 显示工具栏
  if (toolbarEl) {
    showToolbar(onBookmark)
  }

  // 重新定位
  if (currentPopup) {
    positionPopup(currentPopup, originX, originY)
  }

  log.debug('笔记结果已更新', { noteContent: noteContent.slice(0, 30) })
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
    contentEl.style.color = 'var(--aib-text-soft, #888)'
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
          contentEl.style.display = ''  // 确保内容区可见
        }
        if (noteContentEl) noteContentEl.style.display = 'none'
        if (loadingEl) loadingEl.style.display = ''
        toolbarEl!.style.display = 'none'
        currentTranslated = ''
        currentNoteContent = ''
        onRetry()
      })
      toolbarEl.appendChild(retryBtn)
    }

    const closeBtn = createToolButton('关闭', () => hideTranslatePopup())
    toolbarEl.appendChild(closeBtn)
  }

  // 重新定位
  if (currentPopup) {
    positionPopup(currentPopup, originX, originY)
  }

  log.debug('翻译错误已显示', { message })
}

/**
 * 显示浮层（直接显示译文，无 loading 阶段）
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
 * 隐藏浮层
 */
export function hideTranslatePopup(): void {
  if (currentPopup) {
    currentPopup.remove()
    currentPopup = null
  }
  contentEl = null
  loadingEl = null
  toolbarEl = null
  noteContentEl = null
  currentTranslated = ''
  currentNoteContent = ''
  originX = 0
  originY = 0
}

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

/** 显示工具栏（根据有无翻译/笔记决定按钮） */
function showToolbar(onBookmark?: (content: string) => void): void {
  if (!toolbarEl) return

  const hasButtons = currentTranslated || (currentNoteContent && onBookmark)
  if (!hasButtons) {
    toolbarEl.style.display = 'none'
    return
  }

  toolbarEl.style.display = 'flex'
  toolbarEl.innerHTML = ''

  // 复制按钮（有翻译内容时显示）
  if (currentTranslated) {
    const copyBtn = createToolButton('复制', () => {
      navigator.clipboard.writeText(currentTranslated).then(() => {
        copyBtn.textContent = '已复制'
        setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
      }).catch(() => {
        log.warn('复制失败')
      })
    })
    toolbarEl.appendChild(copyBtn)
  }

  // 收藏笔记按钮（有笔记内容时显示）
  if (currentNoteContent && onBookmark) {
    const bookmarkBtn = createToolButton('⭐ 收藏笔记', () => {
      onBookmark(currentNoteContent)
      bookmarkBtn.textContent = '已收藏'
      setTimeout(() => hideTranslatePopup(), 500)
    }, '#8b5cf6')
    toolbarEl.appendChild(bookmarkBtn)
  }
}

/** 定位弹窗（文档坐标，跟随页面滚动） */
function positionPopup(popup: HTMLElement, x: number, y: number): void {
  // 转换为文档坐标
  const docX = x + window.scrollX
  const docY = y + window.scrollY

  // 先用临时定位测量尺寸
  popup.style.left = '0px'
  popup.style.top = '0px'
  const rect = popup.getBoundingClientRect()
  const vpWidth = window.innerWidth

  let left = docX
  let top = docY + OFFSET

  // 水平方向：确保不超出视口右边界
  if (left + rect.width > window.scrollX + vpWidth - 12) {
    left = window.scrollX + vpWidth - rect.width - 12
  }
  if (left < window.scrollX + 12) left = window.scrollX + 12

  popup.style.left = `${left}px`
  popup.style.top = `${top}px`
}

/** 创建工具栏按钮 */
function createToolButton(text: string, onClick: () => void, color?: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = text
  Object.assign(btn.style, {
    padding: '2px 10px',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '6px',
    background: color ? `${color}22` : 'rgba(255,255,255,0.08)',
    color: color || '#ccc',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s ease',
  })
  btn.addEventListener('mouseenter', () => {
    btn.style.background = color ? `${color}44` : 'rgba(255,255,255,0.15)'
    btn.style.color = '#fff'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = color ? `${color}22` : 'rgba(255,255,255,0.08)'
    btn.style.color = color || '#ccc'
  })
  btn.addEventListener('click', onClick)
  return btn
}
