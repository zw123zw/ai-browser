/**
 * 点击翻译/笔记
 *
 * 点击页面文本区域 → 取最近的块级父元素 → 下方展示翻译和/或笔记。
 * 再次点击隐藏（不删除），第三次点击显示缓存。
 * 无缓存时请求 AI，有缓存直接显示。
 *
 * 流程：
 * 1. click → 找到最近块级父元素
 * 2. 无记录 → 请求 AI → 显示翻译和/或笔记
 * 3. 有且显示中 → 隐藏
 * 4. 有且已隐藏 → 显示
 */

import { renderMarkdown } from '@/src/utils/markdown'
import { optimizeAsNoteStream } from '@/src/browser/note-service'
import { createAdapter } from '@/src/adapters'
import { buildSelectionTranslateMessage, TRANSLATE_SYSTEM_PROMPT } from '@/src/input/prompts/translate'
import { parseSingleTranslation } from '@/src/browser/translate-parser'
import { Logger } from '@/src/utils/logger'
import type { AppSettings, StreamChunk } from '@/src/types'

const log = new Logger('TranslateClick')

/** 块级内容元素标签 */
const BLOCK_TAGS = new Set([
  'P', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'PRE',
  'ARTICLE', 'SECTION', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV',
  'DIV',
])

/** 内联元素标签（向上查找时跳过） */
const INLINE_TAGS = new Set([
  'SPAN', 'A', 'EM', 'STRONG', 'CODE', 'B', 'I', 'U', 'S', 'SMALL',
  'MARK', 'ABBR', 'SUB', 'SUP', 'KBD', 'VAR', 'SAMP', 'CITE', 'Q',
  'TIME', 'DATA', 'DFN', 'RUBY', 'RT', 'RP', 'WBR', 'FONT',
  'LABEL', 'OUTPUT',
])

/** 翻译缓存：sourceEl → { translated, noteContent, resultEl } */
const translationCache = new WeakMap<HTMLElement, { translated: string; noteContent: string; resultEl: HTMLElement }>()

/** 注入样式（幂等） */
function ensureStyles(): void {
  if (document.getElementById('aib-click-translate-style')) return
  const style = document.createElement('style')
  style.id = 'aib-click-translate-style'
  style.textContent = `
    .aib-click-result {
      position: relative;
      margin: 6px 0;
      padding: 12px 16px;
      padding-right: 36px;
      border-radius: 8px;
      border: 1px solid var(--aib-border, rgba(255,255,255,0.08));
      background: var(--aib-bg-card, #1e1e2e);
      font-size: 14px;
      line-height: 1.7;
      color: var(--aib-text, #e0e0e0);
      animation: aib-click-in 0.2s ease;
      max-height: 360px;
      overflow-y: auto;
    }
    .aib-click-result::-webkit-scrollbar { width: 4px; }
    .aib-click-result::-webkit-scrollbar-track { background: transparent; }
    .aib-click-result::-webkit-scrollbar-thumb { background: var(--aib-primary-soft, rgba(255,255,255,0.15)); border-radius: 2px; }
    .aib-click-result-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--aib-text-soft, #888);
      font-size: 14px;
      line-height: 22px;
      text-align: center;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s ease;
    }
    .aib-click-result-close:hover {
      background: var(--aib-bg-hover, rgba(255,255,255,0.1));
      color: var(--aib-text, #fff);
    }
    @keyframes aib-click-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .aib-click-result-content {
      word-break: break-word;
      white-space: pre-wrap;
    }
    .aib-click-result-loading {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--aib-text-soft, #888);
      padding: 2px 0;
    }
    .aib-click-result-loading .aib-dot-anim {
      display: inline-block;
      width: 20px;
      font-size: 0;
    }
    .aib-click-result-loading .aib-dot-anim::after {
      content: '...';
      font-size: 13px;
      animation: aib-dot-blink 1.2s infinite steps(3, end);
    }
    @keyframes aib-dot-blink {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
    .aib-click-result-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--aib-border, rgba(255,255,255,0.08));
    }
    .aib-click-result-label {
      font-size: 11px;
      color: var(--aib-text-soft, #666);
    }
    .aib-click-result-actions {
      display: flex;
      gap: 6px;
    }
    .aib-click-result-btn {
      padding: 3px 12px;
      border: 1px solid var(--aib-border, rgba(255,255,255,0.12));
      border-radius: 6px;
      background: var(--aib-bg-card, rgba(255,255,255,0.04));
      color: var(--aib-text-soft, #aaa);
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s ease;
      line-height: 1.4;
    }
    .aib-click-result-btn:hover {
      background: var(--aib-bg-hover, rgba(255,255,255,0.1));
      color: var(--aib-text, #fff);
    }
    .aib-click-result-note {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--aib-border, rgba(255,255,255,0.1));
    }
    .aib-click-result-note-label {
      font-size: 11px;
      color: var(--aib-primary, #8b5cf6);
      margin-bottom: 4px;
      font-weight: 600;
    }
    .aib-click-result-note-content {
      font-size: 13px;
      line-height: 1.6;
      color: var(--aib-text, #d0d0d0);
    }
    .aib-click-result-btn-bookmark {
      background: var(--aib-primary-soft, rgba(139,92,246,0.12));
      border-color: var(--aib-primary-glow, rgba(139,92,246,0.3));
      color: var(--aib-primary, #a78bfa);
    }
    .aib-click-result-btn-bookmark:hover {
      background: var(--aib-primary-glow, rgba(139,92,246,0.25));
      color: var(--aib-primary, #c4b5fd);
    }
  `
  document.head.appendChild(style)
}

/**
 * 判断元素是否是"叶子内容块"
 */
function isLeafContentBlock(el: HTMLElement): boolean {
  const tag = el.tagName
  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'PRE', 'LI', 'TD', 'TH'].includes(tag)) {
    return true
  }
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName) || child.tagName === 'TABLE' || child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'DL') {
      return false
    }
  }
  return true
}

/**
 * 判断元素是否是布局容器
 */
function isLayoutContainer(el: HTMLElement): boolean {
  const tag = el.tagName
  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'PRE', 'LI', 'TD', 'TH'].includes(tag)) {
    return false
  }
  let blockChildren = 0
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName) || child.tagName === 'TABLE' || child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'DL') {
      blockChildren++
    }
  }
  return blockChildren >= 2
}

/**
 * 从容器内找到离点击目标最近的叶子内容块
 */
function findNearestLeafIn(container: HTMLElement, target: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = target
  while (el && el !== container) {
    if (el.parentElement === container) {
      return el
    }
    el = el.parentElement
  }
  for (const child of Array.from(container.children)) {
    if (BLOCK_TAGS.has(child.tagName)) return child as HTMLElement
  }
  return container
}

/**
 * 从点击目标向上找到语义父级元素
 */
function findSemanticParent(target: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = target
  while (el) {
    if (el.classList.contains('aib-click-result')) return null

    const tag = el.tagName

    if (tag === 'TD' || tag === 'TH' || tag === 'TR' || tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') {
      const table = el.closest('table')
      return table as HTMLElement | null
    }

    if (tag === 'DT' || tag === 'DD') {
      const dl = el.closest('dl')
      return dl as HTMLElement | null
    }

    if (tag === 'LI') {
      const list = el.closest('ol, ul')
      if (list && list.querySelectorAll(':scope > li').length > 1) {
        return list as HTMLElement
      }
      return el
    }

    if (BLOCK_TAGS.has(tag)) {
      if (isLayoutContainer(el)) {
        return findNearestLeafIn(el, target)
      }
      return el
    }

    if (!INLINE_TAGS.has(tag)) return el

    el = el.parentElement
  }
  return null
}

/**
 * 创建结果容器
 */
function createResultContainer(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'aib-click-result'
  container.setAttribute('translate', 'no')

  // 右上角关闭按钮
  const closeBtn = document.createElement('button')
  closeBtn.className = 'aib-click-result-close'
  closeBtn.textContent = '✕'
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    container.style.display = 'none'
  })
  container.appendChild(closeBtn)

  // loading
  const loading = document.createElement('div')
  loading.className = 'aib-click-result-loading'
  loading.innerHTML = '<span>处理中</span><span class="aib-dot-anim"></span>'
  container.appendChild(loading)

  // 翻译内容区
  const content = document.createElement('div')
  content.className = 'aib-click-result-content'
  content.style.display = 'none'
  container.appendChild(content)

  // 笔记内容区
  const noteSection = document.createElement('div')
  noteSection.className = 'aib-click-result-note'
  noteSection.style.display = 'none'
  const noteLabel = document.createElement('div')
  noteLabel.className = 'aib-click-result-note-label'
  noteLabel.textContent = '📝 AI 笔记'
  noteSection.appendChild(noteLabel)
  const noteContent = document.createElement('div')
  noteContent.className = 'aib-click-result-note-content'
  noteSection.appendChild(noteContent)
  container.appendChild(noteSection)

  // 底栏
  const bar = document.createElement('div')
  bar.className = 'aib-click-result-bar'
  bar.style.display = 'none'
  container.appendChild(bar)

  ;(container as any).__loading = loading
  ;(container as any).__content = content
  ;(container as any).__noteSection = noteSection
  ;(container as any).__noteContent = noteContent
  ;(container as any).__bar = bar

  return container
}

/**
 * 填充结果（翻译和/或笔记）
 */
function fillResult(
  container: HTMLElement,
  translated: string | null,
  noteContent: string | null,
  onBookmark?: (content: string) => void,
): void {
  const loading = (container as any).__loading as HTMLElement
  const content = (container as any).__content as HTMLElement
  const noteSection = (container as any).__noteSection as HTMLElement
  const noteContentDiv = (container as any).__noteContent as HTMLElement
  const bar = (container as any).__bar as HTMLElement

  loading.style.display = 'none'

  // 翻译内容
  if (translated) {
    content.textContent = translated
    content.style.display = ''
  }

  // 笔记内容
  if (noteContent) {
    noteContentDiv.innerHTML = renderMarkdown(noteContent)
    noteSection.style.display = ''
  }

  // 底栏
  bar.style.display = ''
  bar.innerHTML = ''

  // 左侧标签
  const labels: string[] = []
  if (translated) labels.push('AI 翻译')
  if (noteContent) labels.push('AI 笔记')
  const label = document.createElement('span')
  label.className = 'aib-click-result-label'
  label.textContent = labels.join(' · ')
  bar.appendChild(label)

  // 右侧按钮
  const actions = document.createElement('div')
  actions.className = 'aib-click-result-actions'

  if (translated) {
    const copyBtn = document.createElement('button')
    copyBtn.className = 'aib-click-result-btn'
    copyBtn.textContent = '复制'
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      navigator.clipboard.writeText(translated).then(() => {
        copyBtn.textContent = '已复制'
        setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
      }).catch(() => log.warn('复制失败'))
    })
    actions.appendChild(copyBtn)
  }

  if (noteContent && onBookmark) {
    const bookmarkBtn = document.createElement('button')
    bookmarkBtn.className = 'aib-click-result-btn aib-click-result-btn-bookmark'
    bookmarkBtn.textContent = '⭐ 收藏笔记'
    bookmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      onBookmark(noteContent)
      bookmarkBtn.textContent = '已收藏'
      setTimeout(() => { bookmarkBtn.textContent = '⭐ 收藏笔记' }, 1500)
    })
    actions.appendChild(bookmarkBtn)
  }

  bar.appendChild(actions)
}

/**
 * 流式更新翻译内容（追加增量）
 */
function fillTranslateStreaming(container: HTMLElement, full: string): void {
  const loading = (container as any).__loading as HTMLElement
  const content = (container as any).__content as HTMLElement
  loading.style.display = 'none'
  content.textContent = full
  content.style.display = ''
}

/**
 * 流式更新笔记内容（追加增量）
 */
function fillNoteStreaming(container: HTMLElement, full: string): void {
  const loading = (container as any).__loading as HTMLElement
  const noteSection = (container as any).__noteSection as HTMLElement
  const noteContentDiv = (container as any).__noteContent as HTMLElement
  loading.style.display = 'none'
  noteSection.style.display = ''
  noteContentDiv.textContent = full
}

/**
 * 显示错误
 */
function fillError(container: HTMLElement, message: string, onRetry?: () => void): void {
  const loading = (container as any).__loading as HTMLElement
  const content = (container as any).__content as HTMLElement
  const bar = (container as any).__bar as HTMLElement

  content.textContent = message
  content.style.display = ''
  content.style.color = 'var(--aib-text-soft, #888)'
  content.style.fontSize = '13px'
  loading.style.display = 'none'

  bar.style.display = ''
  bar.innerHTML = ''

  const actions = document.createElement('div')
  actions.className = 'aib-click-result-actions'

  if (onRetry) {
    const retryBtn = document.createElement('button')
    retryBtn.className = 'aib-click-result-btn'
    retryBtn.textContent = '刷新'
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      content.style.display = 'none'
      content.style.color = ''
      content.style.fontSize = ''
      bar.style.display = 'none'
      loading.style.display = ''
      onRetry()
    })
    actions.appendChild(retryBtn)
  }

  bar.appendChild(actions)
}

/**
 * 插入结果容器到原元素后面
 */
function insertAfter(sourceEl: HTMLElement, resultEl: HTMLElement): void {
  if (sourceEl.nextSibling) {
    sourceEl.parentNode?.insertBefore(resultEl, sourceEl.nextSibling)
  } else {
    sourceEl.parentNode?.appendChild(resultEl)
  }
}

/**
 * 初始化点击翻译/笔记功能
 */
export function initClickTranslate(
  translateService: { translateSelection: (text: string, targetLang: string, settings: AppSettings, modelId?: string) => Promise<string> },
  getSettings: () => Promise<AppSettings | null>,
  getCurrentModelId?: () => Promise<string | undefined>,
): void {
  ensureStyles()

  /** 检测元素是否在扩展 UI 内 */
  function isInExtensionUI(el: Node | null): boolean {
    if (!el) return false
    const node = el instanceof HTMLElement ? el : el.parentElement
    if (!node) return false
    if (node.closest('.aib-translate-popup')) return true
    if (node.closest('.aib-click-result')) return true
    const root = node.getRootNode()
    if (root instanceof ShadowRoot) {
      const host = root.host as HTMLElement
      if (host.parentElement === document.body && host.style.position === 'fixed' && host.style.width === '0') return true
      if (host.getAttribute('data-shadow-root') !== null) return true
    }
    return false
  }

  document.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement
    if (isInExtensionUI(target)) return
    if (target.closest('.aib-click-result')) return

    const settings = await getSettings()
    const isTranslate = settings?.translateMode === 'click'
    const isNote = settings?.noteMode === 'click'
    if (!isTranslate && !isNote) return

    const blockEl = findSemanticParent(target)
    if (!blockEl) return

    // 检查缓存
    const cached = translationCache.get(blockEl)

    if (cached) {
      const isHidden = cached.resultEl.style.display === 'none'
      if (isHidden) {
        cached.resultEl.style.display = ''
        blockEl.setAttribute('data-aib-click-hidden', 'false')
      } else {
        cached.resultEl.style.display = 'none'
        blockEl.setAttribute('data-aib-click-hidden', 'true')
      }
      return
    }

    // 无缓存：请求翻译/笔记
    const text = blockEl.innerText?.trim()
    if (!text || text.length < 2) return

    const resultEl = createResultContainer()
    insertAfter(blockEl, resultEl)

    // 先存一个空缓存，防止重复请求
    translationCache.set(blockEl, { translated: '', noteContent: '', resultEl })

    // 收藏笔记回调
    function onBookmark(noteContent: string) {
      window.dispatchEvent(new CustomEvent('aib-bookmark-note', {
        detail: { content: noteContent, url: location.href, scrollY: window.scrollY, selectedText: text, source: 'click' },
      }))
    }

    // 并行调用翻译和笔记 AI
    const tasks: Promise<void>[] = []
    let translateFailed = false
    let noteFailed = false

    if (isTranslate) {
      tasks.push(
        (async () => {
          try {
            const targetLang = settings!.translateTargetLang || '中文'
            log.info('[点击翻译] 触发', { tag: blockEl.tagName, text: text.slice(0, 50), targetLang })
            const modelId = await getCurrentModelId?.()
            const models = settings!.models || []
            const model = modelId
              ? models.find((m) => m.id === modelId) || models[0]
              : models.find((m) => m.id === settings!.defaultModelId) || models[0]
            if (!model) { translateFailed = true; return }

            const adapter = createAdapter(model.provider)
            const messages = [
              { id: 'sys', role: 'system' as const, content: TRANSLATE_SYSTEM_PROMPT, timestamp: Date.now() },
              { id: 'user', role: 'user' as const, content: buildSelectionTranslateMessage(text, targetLang), timestamp: Date.now() },
            ]
            let raw = ''
            await adapter.chat(
              { baseUrl: model.baseUrl || settings!.baseUrl || '', apiKey: model.apiKey || settings!.apiKey || '', modelName: model.modelName, provider: model.provider, messages },
              (chunk: StreamChunk) => {
                if (chunk.delta) {
                  raw += chunk.delta
                  fillTranslateStreaming(resultEl, raw)
                }
              },
            )
            const translated = parseSingleTranslation(raw)
            if (translated) {
              log.info('[点击翻译] 完成', { translated: translated.slice(0, 50) })
              const cached = translationCache.get(blockEl)
              if (cached) {
                cached.translated = translated
                fillResult(resultEl, cached.translated, cached.noteContent, onBookmark)
              }
            } else {
              translateFailed = true
            }
          } catch (err) {
            log.error('[点击翻译] 失败', err)
            translateFailed = true
          }
        })(),
      )
    }

    if (isNote) {
      tasks.push(
        (async () => {
          try {
            log.info('[点击笔记] 触发', { tag: blockEl.tagName, text: text.slice(0, 50) })
            const modelId = await getCurrentModelId?.()
            const noteContent = await optimizeAsNoteStream(text, settings!, (delta, full) => {
              fillNoteStreaming(resultEl, full)
            }, modelId)
            if (noteContent) {
              log.info('[点击笔记] 完成', { noteContent: noteContent.slice(0, 50) })
              const cached = translationCache.get(blockEl)
              if (cached) {
                cached.noteContent = noteContent
                fillResult(resultEl, cached.translated, cached.noteContent, onBookmark)
              }
            } else {
              noteFailed = true
            }
          } catch (err) {
            log.error('[点击笔记] 失败', err)
            noteFailed = true
          }
        })(),
      )
    }

    await Promise.allSettled(tasks)

    // 所有任务完成后的错误处理
    const finalCached = translationCache.get(blockEl)
    if (!finalCached) return

    // 两者都失败 → 显示错误并清除缓存
    if (translateFailed && noteFailed) {
      fillError(resultEl, '翻译和笔记均失败', () => {
        translationCache.delete(blockEl)
        resultEl.remove()
      })
      translationCache.delete(blockEl)
      return
    }

    // 仅翻译失败（笔记成功）→ 在翻译区显示错误提示
    if (translateFailed && !noteFailed) {
      const content = (resultEl as any).__content as HTMLElement
      if (content && !finalCached.translated) {
        content.textContent = '翻译失败'
        content.style.display = ''
        content.style.color = 'var(--aib-text-soft, #888)'
        content.style.fontSize = '13px'
      }
    }

    // 仅笔记失败（翻译成功）→ 静默处理，翻译结果仍显示
    if (noteFailed) {
      log.warn('[点击笔记] 笔记失败，翻译结果仍可用')
    }

    // 如果两者都为空（无缓存内容），清除缓存
    if (!finalCached.translated && !finalCached.noteContent) {
      translationCache.delete(blockEl)
    }
  }, true)
}
