/**
 * 划词翻译/笔记浮层弹窗
 *
 * 选中文本后在选区附近显示翻译结果和/或笔记结果。
 * 纯 DOM 实现（不依赖 Vue），轻量且独立于 Shadow DOM。
 *
 * 功能：
 * - 拖拽移动、拉伸宽度
 * - loading 状态动画
 * - 译文 + 原文对照
 * - 笔记 markdown 渲染（与聊天区域一致）
 * - 复制按钮（翻译模式）
 * - 收藏笔记按钮（笔记模式，不关闭浮层）
 * - 关闭按钮
 * - 跟随滚动容器
 */

import { renderMarkdown } from '@/src/utils/markdown'
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
/** 原始触发坐标（视口坐标） */
let originX = 0
let originY = 0
/** 拖拽状态 */
let isDragging = false
let dragOffsetX = 0
let dragOffsetY = 0
/** 拉伸状态 */
let isResizing = false
let resizeDir: 'left' | 'right' | 'top' | 'bottom' = 'right'
let resizeStartX = 0
let resizeStartY = 0
let resizeStartWidth = 0
let resizeStartHeight = 0
let resizeStartLeft = 0
let resizeStartTop = 0

/** 弹窗默认宽度 */
const DEFAULT_WIDTH = 560
/** 弹窗与选区的间距 */
const OFFSET = 8

/**
 * 显示浮层（loading 状态）
 */
export function showTranslateLoading(x: number, y: number, original: string): void {
  hideTranslatePopup()

  const popup = document.createElement('div')
  popup.className = 'aib-translate-popup'
  popup.setAttribute('translate', 'no')

  Object.assign(popup.style, {
    position: 'fixed',
    zIndex: '2147483646',
    width: `${DEFAULT_WIDTH}px`,
    minWidth: '200px',
    maxWidth: '90vw',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: '0',
    background: '#1a1a2e',
    color: '#e0e0e0',
    borderRadius: '10px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    fontSize: '14px',
    lineHeight: '1.6',
    wordBreak: 'break-word',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    transition: 'opacity 0.15s ease',
    opacity: '0',
    pointerEvents: 'auto',
  })

  // ─── 顶部拖拽条 ───
  const dragHandle = document.createElement('div')
  Object.assign(dragHandle.style, {
    height: '28px',
    cursor: 'move',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 36px 0 10px',
    userSelect: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: '0',
  })
  // 拖拽指示器（三个小点）
  const gripDots = document.createElement('div')
  Object.assign(gripDots.style, {
    width: '24px', height: '3px', borderRadius: '2px',
    background: 'rgba(255,255,255,0.15)', margin: '0 auto',
  })
  dragHandle.appendChild(gripDots)

  dragHandle.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return
    isDragging = true
    const rect = popup.getBoundingClientRect()
    dragOffsetX = e.clientX - rect.left
    dragOffsetY = e.clientY - rect.top
    e.preventDefault()
  })
  popup.appendChild(dragHandle)

  // ─── 关闭按钮 ───
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '4px', right: '6px',
    width: '22px', height: '22px', border: 'none', borderRadius: '4px',
    background: 'transparent', color: '#888', fontSize: '13px',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0', lineHeight: '1', zIndex: '1',
  })
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; closeBtn.style.background = 'rgba(255,255,255,0.1)' })
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#888'; closeBtn.style.background = 'transparent' })
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); hideTranslatePopup() })
  popup.appendChild(closeBtn)

  // ─── 内容包装区（可滚动） ───
  const body = document.createElement('div')
  body.className = 'aib-popup-body'
  Object.assign(body.style, {
    padding: '12px 16px',
    flex: '1',
    overflowY: 'auto',
    overflowX: 'hidden',
    minHeight: '0',
  })

  // 翻译内容区
  const content = document.createElement('div')
  content.style.marginBottom = '6px'
  content.style.minHeight = '20px'
  contentEl = content
  body.appendChild(content)

  // 原文
  const origEl = document.createElement('div')
  Object.assign(origEl.style, {
    fontSize: '12px', color: '#888',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    paddingTop: '6px', marginTop: '4px',
  })
  origEl.textContent = original
  body.appendChild(origEl)

  // 笔记内容区（初始隐藏）
  const noteSection = document.createElement('div')
  Object.assign(noteSection.style, {
    display: 'none', marginTop: '8px', paddingTop: '8px',
    borderTop: '1px solid rgba(255,255,255,0.15)',
  })
  const noteLabel = document.createElement('div')
  noteLabel.textContent = '📝 AI 笔记'
  Object.assign(noteLabel.style, {
    fontSize: '11px', color: '#8b5cf6', marginBottom: '4px', fontWeight: '600',
  })
  noteSection.appendChild(noteLabel)
  const noteContent = document.createElement('div')
  noteContent.className = 'aib-msg-text'
  Object.assign(noteContent.style, { whiteSpace: 'normal' })
  noteSection.appendChild(noteContent)
  noteContentEl = noteSection
  body.appendChild(noteSection)

  // loading 区
  const loading = document.createElement('div')
  Object.assign(loading.style, {
    display: 'flex', alignItems: 'center', gap: '6px',
    marginTop: '8px', paddingTop: '6px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    fontSize: '12px', color: '#888',
  })
  const dots = document.createElement('span')
  dots.textContent = '处理中'
  Object.assign(dots.style, { letterSpacing: '1px' })
  const animDots = document.createElement('span')
  animDots.className = 'aib-translate-dots'
  Object.assign(animDots.style, { display: 'inline-block', width: '20px', textAlign: 'left' })
  animDots.textContent = '...'
  loading.appendChild(dots)
  loading.appendChild(animDots)
  loadingEl = loading
  body.appendChild(loading)

  popup.appendChild(body)

  // ─── 工具栏（固定在底部，不随内容滚动） ───
  const toolbar = document.createElement('div')
  Object.assign(toolbar.style, {
    display: 'none', justifyContent: 'flex-end', gap: '8px',
    padding: '8px 16px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    flexShrink: '0',
    background: '#1a1a2e',
    borderRadius: '0 0 10px 10px',
  })
  toolbarEl = toolbar
  popup.appendChild(toolbar)

  // ─── 四方向拉伸条 ───
  const resizeHandles: Array<{ el: HTMLElement; dir: string; cursor: string }> = []
  const dirs = [
    { dir: 'left',   cursor: 'col-resize',    style: { left:'-3px', top:'0', bottom:'0', width:'6px' } },
    { dir: 'right',  cursor: 'col-resize',    style: { right:'-3px', top:'0', bottom:'0', width:'6px' } },
    { dir: 'top',    cursor: 'row-resize',    style: { top:'-3px', left:'0', right:'0', height:'6px' } },
    { dir: 'bottom', cursor: 'row-resize',    style: { bottom:'-3px', left:'0', right:'0', height:'6px' } },
  ]
  for (const d of dirs) {
    const handle = document.createElement('div')
    Object.assign(handle.style, {
      position: 'absolute', zIndex: '2', ...d.style,
      cursor: d.cursor,
    })
    handle.addEventListener('mousedown', (e) => {
      isResizing = true
      resizeDir = d.dir as any
      resizeStartX = e.clientX
      resizeStartY = e.clientY
      resizeStartWidth = popup.offsetWidth
      resizeStartHeight = popup.offsetHeight
      resizeStartLeft = popup.offsetLeft
      resizeStartTop = popup.offsetTop
      e.preventDefault()
      e.stopPropagation()
    })
    popup.appendChild(handle)
  }

  // ─── CSS ───
  const styleEl = document.createElement('style')
  styleEl.textContent = `
    @keyframes aib-dot-blink { 0%,20%{content:'.'} 40%{content:'..'} 60%,100%{content:'...'} }
    .aib-translate-dots::after { content:'...'; animation:aib-dot-blink 1.2s infinite steps(3,end); }
    .aib-translate-dots { font-size:0; }
    .aib-translate-dots::after { font-size:12px; }
    .aib-translate-popup::-webkit-scrollbar { width:0; }
    .aib-popup-body::-webkit-scrollbar { width:4px; }
    .aib-popup-body::-webkit-scrollbar-track { background:transparent; }
    .aib-popup-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.15); border-radius:2px; }
    .aib-popup-body::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.25); }
    .aib-msg-text p { margin:6px 0; }
    .aib-msg-text p:only-child,.aib-msg-text p:last-child { margin-bottom:0; }
    .aib-msg-text h1,.aib-msg-text h2,.aib-msg-text h3,.aib-msg-text h4 { margin:12px 0 6px; font-weight:600; color:#f4f4f5; }
    .aib-msg-text h1 { font-size:16px; color:#a78bfa; border-bottom:1px solid rgba(167,139,250,0.2); padding-bottom:6px; }
    .aib-msg-text h2 { font-size:15px; color:#c4b5fd; }
    .aib-msg-text h3 { font-size:14px; color:#ddd6fe; }
    .aib-msg-text ul,.aib-msg-text ol { margin:6px 0; padding-left:20px; }
    .aib-msg-text li { margin:3px 0; }
    .aib-msg-text li::marker { color:#a78bfa; }
    .aib-msg-text li > ul,.aib-msg-text li > ol { margin:2px 0; }
    .aib-msg-text strong { color:#fbbf24; font-weight:600; }
    .aib-msg-text em { color:#93c5fd; }
    .aib-msg-text a { color:#60a5fa; text-decoration:none; }
    .aib-msg-text a:hover { text-decoration:underline; }
    .aib-msg-text code:not(.hljs) { background:rgba(139,92,246,0.15); color:#c4b5fd; padding:2px 6px; border-radius:4px; font-size:12px; }
    .aib-msg-text pre { background:rgba(0,0,0,0.4); padding:10px 12px; border-radius:8px; overflow-x:auto; margin:8px 0; border:1px solid rgba(255,255,255,0.06); }
    .aib-msg-text pre code { background:none; color:#d4d4d8; padding:0; }
    .aib-msg-text blockquote { border-left:3px solid #a78bfa; margin:8px 0; padding:6px 12px; color:#a1a1aa; background:rgba(139,92,246,0.06); border-radius:0 6px 6px 0; }
    .aib-msg-text table { border-collapse:collapse; width:100%; margin:8px 0; }
    .aib-msg-text th { background:rgba(139,92,246,0.12); color:#c4b5fd; font-weight:600; border:1px solid rgba(139,92,246,0.2); padding:8px 12px; font-size:13px; text-align:left; }
    .aib-msg-text td { border:1px solid rgba(255,255,255,0.08); padding:6px 12px; font-size:13px; }
    .aib-msg-text tr:nth-child(even) { background:rgba(255,255,255,0.02); }
    .aib-msg-text hr { border:none; border-top:1px solid rgba(139,92,246,0.2); margin:12px 0; }
    .aib-msg-text img { max-width:100%; border-radius:6px; }
    .aib-msg-text del,.aib-msg-text s { color:#888; }
    .aib-msg-text mark { background:rgba(251,191,36,0.2); color:#fbbf24; border-radius:2px; padding:0 2px; }
    .aib-msg-text kbd { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); border-radius:4px; padding:1px 5px; font-size:12px; }
  `
  popup.appendChild(styleEl)

  document.body.appendChild(popup)
  currentPopup = popup

  originX = x
  originY = y
  positionPopup(popup, x, y)

  requestAnimationFrame(() => { popup.style.opacity = '1' })

  // 全局拖拽 + 拉伸
  const onMouseMove = (e: MouseEvent) => {
    if (isDragging && currentPopup) {
      currentPopup.style.left = `${Math.max(0, e.clientX - dragOffsetX)}px`
      currentPopup.style.top = `${Math.max(0, e.clientY - dragOffsetY)}px`
    }
    if (isResizing && currentPopup) {
      const dx = e.clientX - resizeStartX
      const dy = e.clientY - resizeStartY
      if (resizeDir === 'right') {
        currentPopup.style.width = `${Math.max(200, resizeStartWidth + dx)}px`
      } else if (resizeDir === 'left') {
        const newW = Math.max(200, resizeStartWidth - dx)
        currentPopup.style.width = `${newW}px`
        currentPopup.style.left = `${resizeStartLeft + (resizeStartWidth - newW)}px`
      } else if (resizeDir === 'bottom') {
        currentPopup.style.height = `${Math.max(100, resizeStartHeight + dy)}px`
      } else if (resizeDir === 'top') {
        const newH = Math.max(100, resizeStartHeight - dy)
        currentPopup.style.height = `${newH}px`
        currentPopup.style.top = `${resizeStartTop + (resizeStartHeight - newH)}px`
      }
    }
  }
  const onMouseUp = () => {
    isDragging = false
    isResizing = false
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  // 存储清理引用
  ;(popup as any).__cleanupDrag = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  log.debug('浮层 loading 已显示', { x, y, original: original.slice(0, 30) })
}

/**
 * 更新翻译结果
 */
export function updateTranslateResult(translated: string): void {
  if (!currentPopup) return
  currentTranslated = translated

  if (contentEl) {
    contentEl.style.display = ''
    contentEl.style.color = ''
    contentEl.style.fontSize = ''
    contentEl.textContent = translated
  }
  if (loadingEl) loadingEl.style.display = 'none'
  showToolbar()
  if (currentPopup) positionPopup(currentPopup, originX, originY)

  log.debug('翻译结果已更新', { translated: translated.slice(0, 30) })
}

/**
 * 更新笔记结果
 */
export function updateNoteResult(note: string, onBookmark: (content: string) => void): void {
  if (!currentPopup) return
  currentNoteContent = note

  if (noteContentEl) {
    noteContentEl.style.display = 'block'
    const contentDiv = noteContentEl.querySelector('.aib-msg-text') as HTMLElement
    if (contentDiv) {
      contentDiv.innerHTML = renderMarkdown(note)
    }
  }
  if (loadingEl) loadingEl.style.display = 'none'
  if (toolbarEl) showToolbar(onBookmark)
  if (currentPopup) positionPopup(currentPopup, originX, originY)

  log.debug('笔记结果已更新', { noteContent: note.slice(0, 30) })
}

/**
 * 显示翻译错误
 */
export function updateTranslateError(message: string, onRetry?: () => void): void {
  if (!currentPopup) return

  if (contentEl) {
    contentEl.textContent = message
    contentEl.style.color = '#888'
    contentEl.style.fontSize = '13px'
  }
  if (loadingEl) loadingEl.style.display = 'none'

  if (toolbarEl) {
    toolbarEl.style.display = 'flex'
    toolbarEl.innerHTML = ''

    if (onRetry) {
      const retryBtn = createToolButton('刷新', () => {
        if (contentEl) {
          contentEl.textContent = ''
          contentEl.style.color = ''
          contentEl.style.fontSize = ''
          contentEl.style.display = ''
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

  if (currentPopup) positionPopup(currentPopup, originX, originY)
  log.debug('翻译错误已显示', { message })
}

/**
 * 显示浮层（直接显示译文）
 */
export function showTranslatePopup(x: number, y: number, translated: string, original?: string): void {
  showTranslateLoading(x, y, original || '')
  updateTranslateResult(translated)
}

/**
 * 隐藏浮层
 */
export function hideTranslatePopup(): void {
  if (currentPopup) {
    // 清理拖拽事件
    const cleanup = (currentPopup as any).__cleanupDrag
    if (cleanup) cleanup()
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
  isDragging = false
  isResizing = false
}

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

/** 显示工具栏 */
function showToolbar(onBookmark?: (content: string) => void): void {
  if (!toolbarEl) return

  const hasButtons = currentTranslated || (currentNoteContent && onBookmark)
  if (!hasButtons) {
    toolbarEl.style.display = 'none'
    return
  }

  toolbarEl.style.display = 'flex'
  toolbarEl.innerHTML = ''

  if (currentTranslated) {
    const copyBtn = createToolButton('复制', () => {
      navigator.clipboard.writeText(currentTranslated).then(() => {
        copyBtn.textContent = '已复制'
        setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
      }).catch(() => { log.warn('复制失败') })
    })
    toolbarEl.appendChild(copyBtn)
  }

  if (currentNoteContent && onBookmark) {
    const bookmarkBtn = createToolButton('⭐ 收藏笔记', () => {
      onBookmark(currentNoteContent)
      bookmarkBtn.textContent = '已收藏'
      setTimeout(() => { bookmarkBtn.textContent = '⭐ 收藏笔记' }, 1500)
    }, '#8b5cf6')
    toolbarEl.appendChild(bookmarkBtn)
  }
}

/** 定位弹窗 */
function positionPopup(popup: HTMLElement, x: number, y: number): void {
  popup.style.left = '0px'
  popup.style.top = '0px'
  const rect = popup.getBoundingClientRect()
  const vpWidth = window.innerWidth
  const vpHeight = window.innerHeight

  let left = x
  let top = y + OFFSET

  if (left + rect.width > vpWidth - 12) left = vpWidth - rect.width - 12
  if (left < 12) left = 12
  if (top + rect.height > vpHeight - 12) top = y - rect.height - OFFSET
  if (top < 12) top = 12

  popup.style.left = `${left}px`
  popup.style.top = `${top}px`
}

/** 创建工具栏按钮 */
function createToolButton(text: string, onClick: () => void, color?: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = text
  Object.assign(btn.style, {
    padding: '2px 10px', border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '6px', background: color ? `${color}22` : 'rgba(255,255,255,0.08)',
    color: color || '#ccc', fontSize: '12px', cursor: 'pointer',
    fontFamily: 'inherit', transition: 'all 0.15s ease',
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
