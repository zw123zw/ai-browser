/**
 * 点击翻译
 *
 * 点击页面文本区域 → 取最近的块级父元素 → 下方展示翻译。
 * 再次点击隐藏翻译（不删除），第三次点击显示缓存的翻译。
 * 无缓存时请求 AI 翻译，有缓存直接显示。
 *
 * 流程：
 * 1. click → 找到最近块级父元素
 * 2. 无翻译记录 → 请求 AI → 显示翻译
 * 3. 有翻译且显示中 → 隐藏翻译
 * 4. 有翻译且已隐藏 → 显示翻译
 */

import { Logger } from '@/src/utils/logger'
import type { AppSettings } from '@/src/types'

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

/** 翻译缓存：sourceEl → { translated, resultEl } */
const translationCache = new WeakMap<HTMLElement, { translated: string; resultEl: HTMLElement }>()

/** 注入样式（幂等） */
function ensureStyles(): void {
  if (document.getElementById('zwf-click-translate-style')) return
  const style = document.createElement('style')
  style.id = 'zwf-click-translate-style'
  style.textContent = `
    .zwf-click-result {
      position: relative;
      margin: 6px 0;
      padding: 12px 16px;
      padding-right: 36px;
      border-radius: 8px;
      border: 1px solid var(--zwf-border, rgba(255,255,255,0.08));
      background: var(--zwf-bg-card, #1e1e2e);
      font-size: 14px;
      line-height: 1.7;
      color: var(--zwf-text, #e0e0e0);
      animation: zwf-click-in 0.2s ease;
    }
    .zwf-click-result-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--zwf-text-soft, #888);
      font-size: 14px;
      line-height: 22px;
      text-align: center;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s ease;
    }
    .zwf-click-result-close:hover {
      background: rgba(255,255,255,0.1);
      color: var(--zwf-text, #fff);
    }
    @keyframes zwf-click-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .zwf-click-result-content {
      word-break: break-word;
      white-space: pre-wrap;
    }
    .zwf-click-result-loading {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--zwf-text-soft, #888);
      padding: 2px 0;
    }
    .zwf-click-result-loading .zwf-dot-anim {
      display: inline-block;
      width: 20px;
      font-size: 0;
    }
    .zwf-click-result-loading .zwf-dot-anim::after {
      content: '...';
      font-size: 13px;
      animation: zwf-dot-blink 1.2s infinite steps(3, end);
    }
    @keyframes zwf-dot-blink {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
    .zwf-click-result-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--zwf-border, rgba(255,255,255,0.08));
    }
    .zwf-click-result-label {
      font-size: 11px;
      color: var(--zwf-text-soft, #666);
    }
    .zwf-click-result-actions {
      display: flex;
      gap: 6px;
    }
    .zwf-click-result-btn {
      padding: 3px 12px;
      border: 1px solid var(--zwf-border, rgba(255,255,255,0.12));
      border-radius: 6px;
      background: var(--zwf-bg-card, rgba(255,255,255,0.04));
      color: var(--zwf-text-soft, #aaa);
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s ease;
      line-height: 1.4;
    }
    .zwf-click-result-btn:hover {
      background: var(--zwf-bg-hover, rgba(255,255,255,0.1));
      color: var(--zwf-text, #fff);
    }
  `
  document.head.appendChild(style)
}

/**
 * 判断元素是否是"叶子内容块"——直接包含文本，而不是布局容器
 */
function isLeafContentBlock(el: HTMLElement): boolean {
  const tag = el.tagName
  // 明确的内容元素
  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'PRE', 'LI', 'TD', 'TH'].includes(tag)) {
    return true
  }
  // 检查：没有块级子元素 → 是叶子
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName) || child.tagName === 'TABLE' || child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'DL') {
      return false
    }
  }
  return true
}

/**
 * 判断元素是否是布局容器（太大、太多子块）
 */
function isLayoutContainer(el: HTMLElement): boolean {
  const tag = el.tagName
  // 明确的内容元素不算布局容器
  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'PRE', 'LI', 'TD', 'TH'].includes(tag)) {
    return false
  }
  // 统计块级子元素数量
  let blockChildren = 0
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName) || child.tagName === 'TABLE' || child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'DL') {
      blockChildren++
    }
  }
  // 有多个块级子元素 → 布局容器
  return blockChildren >= 2
}

/**
 * 从容器内找到离点击目标最近的叶子内容块
 */
function findNearestLeafIn(container: HTMLElement, target: HTMLElement): HTMLElement | null {
  // 从 target 向上找，直到遇到 container 的直接子元素
  let el: HTMLElement | null = target
  while (el && el !== container) {
    if (el.parentElement === container) {
      // 这是 container 的直接子元素
      if (isLeafContentBlock(el)) return el
      // 不是叶子，但离点击最近，就用它
      return el
    }
    el = el.parentElement
  }
  // 找不到，返回 container 的第一个块级子元素
  for (const child of Array.from(container.children)) {
    if (BLOCK_TAGS.has(child.tagName)) return child as HTMLElement
  }
  return container
}

/**
 * 从点击目标向上找到语义父级元素
 *
 * 规则：
 * - td/th/tr → <table>
 * - dt/dd → <dl>
 * - li（多个）→ <ol>/<ul>
 * - 明确内容元素（p, h1-h6, blockquote...）→ 直接用
 * - 布局容器（div, section 有多个子块）→ 向下找最近的叶子内容块
 */
function findSemanticParent(target: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = target
  while (el) {
    if (el.classList.contains('zwf-click-result')) return null

    const tag = el.tagName

    // 表格相关：向上找到 table
    if (tag === 'TD' || tag === 'TH' || tag === 'TR' || tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') {
      const table = el.closest('table')
      return table as HTMLElement | null
    }

    // 定义列表项：向上找到 dl
    if (tag === 'DT' || tag === 'DD') {
      const dl = el.closest('dl')
      return dl as HTMLElement | null
    }

    // 列表项：如果列表有多个 item，翻译整个列表
    if (tag === 'LI') {
      const list = el.closest('ol, ul')
      if (list && list.querySelectorAll(':scope > li').length > 1) {
        return list as HTMLElement
      }
      return el
    }

    // 块级元素
    if (BLOCK_TAGS.has(tag)) {
      // 布局容器（多个子块）→ 向下找离点击最近的叶子内容块
      if (isLayoutContainer(el)) {
        return findNearestLeafIn(el, target)
      }
      return el
    }

    // 非内联未知标签
    if (!INLINE_TAGS.has(tag)) return el

    el = el.parentElement
  }
  return null
}

/**
 * 创建翻译结果容器
 */
function createResultContainer(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'zwf-click-result'
  container.setAttribute('translate', 'no')

  // 右上角关闭按钮
  const closeBtn = document.createElement('button')
  closeBtn.className = 'zwf-click-result-close'
  closeBtn.textContent = '✕'
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    container.style.display = 'none'
  })
  container.appendChild(closeBtn)

  // loading
  const loading = document.createElement('div')
  loading.className = 'zwf-click-result-loading'
  loading.innerHTML = '<span>翻译中</span><span class="zwf-dot-anim"></span>'
  container.appendChild(loading)

  // 内容区
  const content = document.createElement('div')
  content.className = 'zwf-click-result-content'
  content.style.display = 'none'
  container.appendChild(content)

  // 底栏
  const bar = document.createElement('div')
  bar.className = 'zwf-click-result-bar'
  bar.style.display = 'none'
  container.appendChild(bar)

  ;(container as any).__loading = loading
  ;(container as any).__content = content
  ;(container as any).__bar = bar

  return container
}

/**
 * 填充翻译结果
 */
function fillResult(container: HTMLElement, translated: string): void {
  const loading = (container as any).__loading as HTMLElement
  const content = (container as any).__content as HTMLElement
  const bar = (container as any).__bar as HTMLElement

  content.textContent = translated
  content.style.display = ''
  loading.style.display = 'none'

  bar.style.display = ''
  bar.innerHTML = ''

  const label = document.createElement('span')
  label.className = 'zwf-click-result-label'
  label.textContent = 'AI 翻译'
  bar.appendChild(label)

  const actions = document.createElement('div')
  actions.className = 'zwf-click-result-actions'

  const copyBtn = document.createElement('button')
  copyBtn.className = 'zwf-click-result-btn'
  copyBtn.textContent = '复制'
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(translated).then(() => {
      copyBtn.textContent = '已复制'
      setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
    }).catch(() => log.warn('复制失败'))
  })
  actions.appendChild(copyBtn)

  bar.appendChild(actions)
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
  content.style.color = 'var(--zwf-text-soft, #888)'
  content.style.fontSize = '13px'
  loading.style.display = 'none'

  // 显示底栏：刷新 + 关闭
  bar.style.display = ''
  bar.innerHTML = ''

  const actions = document.createElement('div')
  actions.className = 'zwf-click-result-actions'

  if (onRetry) {
    const retryBtn = document.createElement('button')
    retryBtn.className = 'zwf-click-result-btn'
    retryBtn.textContent = '刷新'
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      // 恢复 loading 状态
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
 * 初始化点击翻译功能
 */
export function initClickTranslate(
  translateService: { translateSelection: (text: string, targetLang: string, settings: AppSettings, modelId?: string) => Promise<string> },
  getSettings: () => Promise<AppSettings | null>,
  getCurrentModelId?: () => Promise<string | undefined>,
): void {
  ensureStyles()

  /** 检测元素是否在扩展 Shadow DOM 内 */
  function isInExtensionUI(el: Node | null): boolean {
    if (!el) return false
    const node = el instanceof HTMLElement ? el : el.parentElement
    if (!node) return false
    if (node.closest('.zwf-translate-popup')) return true
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
    if (target.closest('.zwf-click-result')) return

    const settings = await getSettings()
    if (settings?.translateMode !== 'click') return

    const blockEl = findSemanticParent(target)
    if (!blockEl) return

    // 检查缓存
    const cached = translationCache.get(blockEl)

    if (cached) {
      // 有缓存：toggle 显示/隐藏
      const isHidden = cached.resultEl.style.display === 'none'
      if (isHidden) {
        cached.resultEl.style.display = ''
        blockEl.setAttribute('data-zwf-click-hidden', 'false')
      } else {
        cached.resultEl.style.display = 'none'
        blockEl.setAttribute('data-zwf-click-hidden', 'true')
      }
      return
    }

    // 无缓存：请求翻译
    const text = blockEl.innerText?.trim()
    if (!text || text.length < 2) return

    const resultEl = createResultContainer()
    insertAfter(blockEl, resultEl)

    // 先存一个空缓存，防止重复请求
    translationCache.set(blockEl, { translated: '', resultEl })

    const controller = new AbortController()

    async function doTranslate() {
      try {
        const targetLang = settings.translateTargetLang || '中文'
        log.info('[点击翻译] 触发', { tag: blockEl.tagName, text: text.slice(0, 50), targetLang })

        const modelId = await getCurrentModelId?.()
        const translated = await translateService.translateSelection(text, targetLang, settings, modelId)

        if (translated) {
          log.info('[点击翻译] 完成', { translated: translated.slice(0, 50) })
          fillResult(resultEl, translated)
          translationCache.set(blockEl, { translated, resultEl })
        } else {
          log.warn('[点击翻译] AI 返回空结果')
          fillError(resultEl, '翻译失败', doTranslate)
          translationCache.delete(blockEl)
        }
      } catch (err) {
        log.error('[点击翻译] 失败', err)
        const msg = err instanceof Error ? err.message : '翻译失败，请重试'
        fillError(resultEl, msg, doTranslate)
        translationCache.delete(blockEl)
      }
    }

    doTranslate()
  }, true)
}
