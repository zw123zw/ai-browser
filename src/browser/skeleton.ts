/**
 * 语义骨架提取器 + 骨架管理器
 *
 * 每次调用 getSkeleton() 都重新提取可视窗口内的可点击骨架。
 * 不缓存、不监听 DOM 变化 — 简单可靠，永不过期。
 *
 * 核心原则：从可视窗口的顶层容器开始，递归扫描所有子元素，
 * 只要可点击（a/button/input/有点击事件/cursor:pointer）就提取。
 *
 * 字段分组（对齐无障碍树）：
 * - 身份：id/tag/role
 * - 内容：text/label/ariaLabel/placeholder
 * - 导航：href
 * - 表单：inputType/value/checked/required
 * - 状态：disabled/expanded/selected
 * - 上下文：parent
 */

import { Logger } from '@/src/utils/logger'
import { INTERACTIVE_TAGS } from './types'
import { ensureAllSkeletonIds, ensureAllSkeletonIdsForDoc } from './skeleton-id'
import type { SkeletonElement, SemanticSkeleton } from './types'

const log = new Logger('Skeleton')

/** 地标标签列表（用于 parent 字段标注） */
const LANDMARK_TAGS = ['nav', 'header', 'main', 'aside', 'footer']
const LANDMARK_ROLES = ['navigation', 'banner', 'main', 'complementary', 'contentinfo']

/** 骨架提取范围 */
export type SkeletonScope = 'viewport' | 'full'

/** 视口骨架最大元素数（减少 token 消耗） */
const MAX_SKELETON_ELEMENTS = 200

/** href 截断长度（仅 href 截断，避免超长 URL） */
const MAX_HREF_LENGTH = 200

/** placeholder 截断长度 */
const MAX_PLACEHOLDER_LENGTH = 50

/**
 * 骨架管理器
 *
 * 每次调用 getSkeleton() 都重新提取可视窗口内的骨架。
 * 无缓存、无 MutationObserver、无 URL 追踪 — 不存在过期问题。
 */
export class SkeletonManager {
  /**
   * 获取当前可视窗口内的语义骨架（每次重新提取）
   */
  getSkeleton(): SemanticSkeleton {
    const skeleton = extractSkeleton(document, 'viewport')
    log.info('骨架提取（viewport）', {
      url: skeleton.url,
      elements: skeleton.elements.length,
    })
    return skeleton
  }

  /**
   * 获取全页面的语义骨架（每次重新提取，无元素上限）
   *
   * 当视口骨架找不到目标元素时，AI 输出 [need_full] 触发。
   */
  getFullSkeleton(): SemanticSkeleton {
    const skeleton = extractSkeleton(document, 'full')
    log.info('骨架提取（full）', {
      url: skeleton.url,
      elements: skeleton.elements.length,
    })
    return skeleton
  }

  /**
   * 获取视口骨架 + 跨域 iframe 内骨架（异步）
   *
   * 主文档 + 同源 iframe 由 extractSkeleton() 同步处理，
   * 跨域 iframe 通过 chrome.scripting.executeScript 注入提取。
   */
  async getSkeletonWithIframes(): Promise<SemanticSkeleton> {
    const skeleton = extractSkeleton(document, 'viewport')

    // 检测跨域 iframe（每次重新遍历）
    // contentDocument 为 null（未加载完）或抛 SecurityError（跨域）都收集
    const crossOriginIframes: HTMLIFrameElement[] = []
    for (const iframe of document.querySelectorAll('iframe')) {
      const el = iframe as HTMLIFrameElement
      try {
        if (!el.contentDocument) crossOriginIframes.push(el)
      } catch {
        crossOriginIframes.push(el)
      }
    }

    if (crossOriginIframes.length > 0) {
      log.info('检测到跨域 iframe，开始注入提取', { count: crossOriginIframes.length })
      const iframeElements = await extractIframeSkeletons(crossOriginIframes, 'viewport')
      skeleton.elements.push(...iframeElements)
    }
    log.info('骨架提取（viewport + iframe）', {
      url: skeleton.url,
      elements: skeleton.elements.length,
      crossOriginIframes: crossOriginIframes.length,
    })
    return skeleton
  }

  /**
   * 获取全页面骨架 + 跨域 iframe 内骨架（异步）
   */
  async getFullSkeletonWithIframes(): Promise<SemanticSkeleton> {
    const skeleton = extractSkeleton(document, 'full')

    const crossOriginIframes: HTMLIFrameElement[] = []
    for (const iframe of document.querySelectorAll('iframe')) {
      const el = iframe as HTMLIFrameElement
      try {
        if (!el.contentDocument) crossOriginIframes.push(el)
      } catch {
        crossOriginIframes.push(el)
      }
    }

    if (crossOriginIframes.length > 0) {
      log.info('检测到跨域 iframe，开始注入提取', { count: crossOriginIframes.length })
      const iframeElements = await extractIframeSkeletons(crossOriginIframes, 'full')
      skeleton.elements.push(...iframeElements)
    }
    log.info('骨架提取（full + iframe）', {
      url: skeleton.url,
      elements: skeleton.elements.length,
      crossOriginIframes: crossOriginIframes.length,
    })
    return skeleton
  }

  /**
   * 标记骨架失效（保留接口兼容，viewport 模式下无需缓存管理）
   */
  invalidate(): void {
    // viewport 模式无缓存，无需操作
  }

  /** 保留接口兼容 */
  dispose(): void {}

  /** 保留接口兼容 */
  get cachedUrl(): string {
    return ''
  }
}

/**
 * 从当前页面提取可点击元素骨架
 *
 * 1. querySelectorAll('*') 获取所有元素
 * 2. 过滤可交互元素（a/button/input/onclick/cursor:pointer 等）
 * 3. 检查可见性（display:none/visibility:hidden/offsetParent）
 * 4. 检查是否在视口内（垂直+水平）— 仅 viewport 模式
 * 5. 过滤空文本 + 按 parent+text 去重
 *
 * @param doc 文档对象
 * @param scope 'viewport'（默认，仅视口内，200 上限）| 'full'（全页面，无上限）
 */
export function extractSkeleton(doc: Document, scope: SkeletonScope = 'viewport'): SemanticSkeleton {
  const elements: SkeletonElement[] = []
  const domParentIdMap = new Map<string, string>()
  const existingIds = new Map<string, boolean>()
  let scannedCount = 0
  let totalInteractive = 0

  // 全量打标：同步计数器 + 给所有元素打 data-skeleton-id（含懒加载元素）
  ensureAllSkeletonIds()

  const allElements = doc.body.querySelectorAll('*')

  function extractFromDoc(
    targetDoc: Document, vpOffsetX: number, vpOffsetY: number,
    forceParent?: string,
  ): void {
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    // 主文档复用外层 allElements，iframe 传入自己的 document
    const allEls = targetDoc === doc ? allElements : targetDoc.body.querySelectorAll('*')

    for (const el of allEls) {
      const htmlEl = el as HTMLElement
      const id = htmlEl.dataset.skeletonId || ''
      if (!id) continue  // ensureAllSkeletonIds 已打标，无 id 的跳过
      existingIds.set(id, true)

      if (!isClickable(htmlEl)) continue
      totalInteractive++

      if (!isElementVisible(htmlEl)) continue

      // viewport 模式：检查是否在视口内；full 模式：跳过视口检测
      if (scope === 'viewport') {
        const rect = htmlEl.getBoundingClientRect()
        const top = rect.top + vpOffsetY, bottom = rect.bottom + vpOffsetY
        const left = rect.left + vpOffsetX, right = rect.right + vpOffsetX
        if (top >= viewportHeight || bottom <= 0) continue
        if (left >= viewportWidth || right <= 0) continue
        if (rect.width < 1 || rect.height < 1) continue
      }

      if (forceParent && existingIds.has(id)) continue

      const element = extractElement(htmlEl, id)
      if (element) {
        element.parent = forceParent || findLandmarkParent(htmlEl)
        const parentEl = htmlEl.parentElement as HTMLElement
        if (parentEl?.dataset?.skeletonId) {
          domParentIdMap.set(id, parentEl.dataset.skeletonId)
        }
        elements.push(element)
      }
    }
  }

  // 主文档提取
  extractFromDoc(doc, 0, 0)
  scannedCount = allElements.length

  // 过滤空文本元素 + 父子同文本去重（保留子级）+ 同级去重
  const elMap = new Map<string, SkeletonElement>()
  for (const el of elements) elMap.set(el.id, el)

  const parentsToRemove = new Set<string>()
  for (const htmlEl of allElements) {
    const sId = (htmlEl as HTMLElement).dataset.skeletonId
    if (!sId) continue
    const el = elMap.get(sId)
    if (!el || !el.text) continue
    // 交互元素（<a>/<button>等）不参与父子去重 — 它们是真正的可操作元素
    if (INTERACTIVE_TAGS.includes(el.tag)) continue
    for (const child of htmlEl.children) {
      const cId = (child as HTMLElement).dataset?.skeletonId
      if (!cId) continue
      const childEl = elMap.get(cId)
      if (!childEl || !childEl.text) continue
      // 精确匹配 或 子串匹配（父含价格等额外内容）→ 去掉父级
      if (childEl.text === el.text || el.text.includes(childEl.text)) {
        parentsToRemove.add(sId)
        break
      }
    }
  }

  const seenByParent = new Map<string, Set<string>>()
  const filtered = elements.filter(el => {
    if (parentsToRemove.has(el.id)) return false
    if (!el.text && !['a', 'button', 'input', 'select', 'textarea'].includes(el.tag)) return false
    if (el.text && el.text !== '(icon)') {
      const parentKey = el.parent || '_root'
      if (!seenByParent.has(parentKey)) seenByParent.set(parentKey, new Set())
      const seen = seenByParent.get(parentKey)!
      const domParentId = domParentIdMap.get(el.id)
      const shouldSkipDedup = domParentId && parentsToRemove.has(domParentId)
      if (!shouldSkipDedup && seen.has(el.text)) return false
      if (!shouldSkipDedup) seen.add(el.text)
    }
    return true
  })
  // viewport 模式有元素上限，full 模式无上限
  const truncated = scope === 'viewport' && filtered.length > MAX_SKELETON_ELEMENTS
  const final = truncated ? filtered.slice(0, MAX_SKELETON_ELEMENTS) : filtered

  // 提取页面上的错误/状态提示文本（非交互元素，但对 AI 决策很重要）
  const alerts = extractAlerts(doc)

  // iframe 处理：同源直接提取 + 跨域收集
  const allIframes = doc.querySelectorAll('iframe')
  let iframeIndex = 0
  for (const iframe of allIframes) {
    const iframeEl = iframe as HTMLIFrameElement

    let iframeDoc: Document | null = null
    try { iframeDoc = iframeEl.contentDocument } catch { /* 跨域 */ }

    if (iframeDoc?.body) {
      // 同源 iframe：直接打标 + 提取
      ensureAllSkeletonIdsForDoc(iframeDoc)
      const iframeLabel = iframeEl.id || iframeEl.getAttribute('name') || `iframe${iframeIndex}`
      scannedCount += iframeDoc.body.querySelectorAll('*').length
      const rect = iframeEl.getBoundingClientRect()
      extractFromDoc(iframeDoc, rect.left, rect.top, `iframe.${iframeLabel}`)
    }
    // 跨域 iframe 不在此处理，由 getSkeletonWithIframes() 通过 chrome.scripting 注入
    iframeIndex++
  }

  // 页面状态
  const hasModal = hasModalOverlay(doc)
  const loading = doc.readyState !== 'complete'
  const focusedEl = doc.activeElement as HTMLElement | null
  const focusedElement = focusedEl?.dataset?.skeletonId || undefined

  log.info('骨架提取完成', {
    scannedCount,
    rawCount: elements.length,
    filteredCount: filtered.length,
    finalCount: final.length,
    truncated,
    alerts: alerts.length,
    hasModal,
    loading,
    focusedElement,
    totalInteractive,
    url: doc.location.href,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    scrollY: window.scrollY,
  })

  return {
    url: doc.location.href,
    title: doc.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { y: window.scrollY, height: doc.documentElement.scrollHeight },
    hasModal,
    loading,
    focusedElement,
    totalInteractive,
    truncated,
    alerts: alerts.length > 0 ? alerts : undefined,
    elements: final,
  }
}


/**
 * 可点击性检测
 *
 * 判断元素是否真正可交互：
 * - a[href] — 链接
 * - button — 按钮
 * - input/select/textarea — 表单元素
 * - video/audio — 媒体元素（可播放/暂停/全屏）
 * - [onclick] — 有点击事件属性
 * - [role="button"] — 语义按钮
 * - [tabindex] — 可聚焦
 * - cursor:pointer — CSS 样式标记为可点击（可能有 addEventListener）
 */
function isClickable(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()

  // 原生交互元素（含媒体元素）
  if (INTERACTIVE_TAGS.includes(tag)) return true

  // contenteditable
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true

  // 属性标记
  if (el.getAttribute('onclick')) return true
  const role = el.getAttribute('role')
  if (role && ['button', 'link', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio'].includes(role)) return true
  if (el.getAttribute('tabindex')) return true

  // CSS cursor:pointer（可能是 addEventListener 绑定的点击事件）
  try {
    const style = window.getComputedStyle(el)
    if (style.cursor === 'pointer') return true
  } catch {
    // getComputedStyle 可能失败，忽略
  }

  // 代码编辑器容器（CodeMirror/Monaco/Ace/ByteMD）
  if (el.classList.contains('CodeMirror') ||
      el.classList.contains('monaco-editor') ||
      el.classList.contains('ace_editor') ||
      el.classList.contains('bytemd-editor')) return true

  return false
}

/**
 * 提取单个元素的完整字段
 *
 * 字段分组：
 * 1. 身份标识：id/tag/role
 * 2. 内容信息：text/label/ariaLabel/placeholder
 * 3. 导航信息：href
 * 4. 表单属性：inputType/value/checked/required
 * 5. 交互状态：disabled/expanded/selected
 */
function extractElement(el: HTMLElement, id: string): SkeletonElement | null {
  const tag = el.tagName.toLowerCase()
  const text = getDirectText(el)
  const hasIcon = !!el.querySelector('svg, img, i, [class*="icon"]')

  // 无文字 + 无 role + 无图标子元素 → 跳过
  // 但 input/textarea 有 placeholder 或 value 时保留（如手机号输入框只有 placeholder）
  // 以及有关联 label 的表单元素也保留（如 <label for="name">活动名称</label> + <input id="name">）
  const isFormElement = ['input', 'textarea', 'select'].includes(tag)
  const hasFormContent = isFormElement && (
    el.getAttribute('placeholder') || (el as HTMLInputElement).value
  )
  const labelText = isFormElement && !text && !hasFormContent
    ? findAssociatedLabelText(el)
    : null
  // ariaLabel 独立提取（不合并进 text）
  const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || null
  const altText = !ariaLabel ? el.querySelector('img')?.getAttribute('alt') : null
  const ariaLabelValue = ariaLabel || altText || null

  // contenteditable 标记
  const isContentEditable = el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''

  // 代码编辑器容器（CodeMirror/Monaco/Ace）— 提取编辑器内容作为 value
  const isEditor = el.classList.contains('CodeMirror') ||
    el.classList.contains('monaco-editor') ||
    el.classList.contains('ace_editor') ||
    el.classList.contains('bytemd-editor')

  if (!text && !el.getAttribute('role') && !hasIcon && !hasFormContent && !labelText && !ariaLabelValue && !isEditor && !isContentEditable) return null

  const base: SkeletonElement = { id, tag }

  // ── 1. 身份标识：role ──
  const role = extractRole(el, tag)
  if (role) base.role = role

  // contenteditable 标记为 textbox
  if (isContentEditable && !base.role) {
    base.role = 'textbox'
  }

  // 代码编辑器容器：标记为 textbox，AI 知道可以输入
  if (isEditor && !base.role) {
    base.role = 'textbox'
    // 提取编辑器当前内容（CodeMirror/Monaco/Ace）
    try {
      const cm = (el as any).CodeMirror
      if (cm) {
        const val = cm.getValue?.() || ''
        if (val) base.value = val
      }
    } catch { /* */ }
  }

  // ── 2. 内容信息：text/label/ariaLabel ──
  if (text) {
    base.text = text
  } else if (hasFormContent) {
    // input/textarea 有 value 时显示已输入内容，让 AI 知道输入是否成功
    const val = (el as HTMLInputElement).value
    if (val) {
      base.text = val
    }
  } else if (labelText) {
    // 表单元素有关联 label 时，用 label 字段标识（不占 text，避免与 label 元素去重）
    base.label = labelText
  } else if (hasIcon && ariaLabelValue) {
    // 图标元素：用 ariaLabel 而非 text（语义更清晰）
    base.ariaLabel = ariaLabelValue
  } else if (hasIcon) {
    base.text = '(icon)'
  }

  // ariaLabel 独立输出（不与 text 合并）
  if (ariaLabelValue && !base.ariaLabel && base.text !== ariaLabelValue) {
    base.ariaLabel = ariaLabelValue
  }

  // label 独立输出（表单元素专用）
  if (labelText && !base.label) {
    base.label = labelText
  }

  // placeholder
  if (isFormElement) {
    const ph = el.getAttribute('placeholder')
    if (ph) base.placeholder = ph.slice(0, MAX_PLACEHOLDER_LENGTH)
  }

  // ── 3. 导航信息：href ──
  if (tag === 'a') {
    const href = el.getAttribute('href')
    if (href && href !== '#' && !href.startsWith('javascript:')) {
      try {
        const url = new URL(href, el.baseURI)
        base.href = url.href.slice(0, MAX_HREF_LENGTH)
      } catch {
        // 无效 URL 不输出
      }
    }
  }

  // ── 4. 表单属性：inputType/value/checked/required ──
  if (tag === 'input') {
    const inputEl = el as HTMLInputElement
    const inputType = inputEl.type || 'text'
    // checkbox/radio 用 checked 字段，不输出 inputType
    if (inputType !== 'checkbox' && inputType !== 'radio') {
      base.inputType = inputType
    }
    // value：密码框不提取（安全考虑）
    if (inputType !== 'password' && inputEl.value) {
      base.value = inputEl.value
    }
    // checked
    if ((inputType === 'checkbox' || inputType === 'radio') && inputEl.checked) {
      base.checked = true
    }
    // required
    if (inputEl.required || el.getAttribute('aria-required') === 'true') {
      base.required = true
    }
  }

  if (tag === 'textarea') {
    const textareaEl = el as HTMLTextAreaElement
    if (textareaEl.value) {
      base.value = textareaEl.value
    }
    if (textareaEl.required || el.getAttribute('aria-required') === 'true') {
      base.required = true
    }
  }

  // contenteditable 元素：提取 innerText 作为 value
  if (isContentEditable) {
    const content = el.innerText?.trim() || ''
    if (content) {
      base.value = content
    }
  }

  if (tag === 'select') {
    const selectEl = el as HTMLSelectElement
    if (selectEl.required || el.getAttribute('aria-required') === 'true') {
      base.required = true
    }
  }

  // ── 5. 交互状态：disabled/expanded/selected ──
  // disabled
  if (isFormElement || tag === 'button') {
    const disabled = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement).disabled
      || el.getAttribute('aria-disabled') === 'true'
    if (disabled) base.disabled = true
  }

  // expanded
  const ariaExpanded = el.getAttribute('aria-expanded')
  if (ariaExpanded === 'true' || (tag === 'details' && ((el as HTMLDetailsElement).open || el.hasAttribute('open')))) {
    base.expanded = true
  }

  // selected
  const ariaSelected = el.getAttribute('aria-selected')
  if (ariaSelected === 'true' || (tag === 'option' && (el as HTMLOptionElement).selected)) {
    base.selected = true
  }

  return base
}

/**
 * 提取元素的 ARIA role
 *
 * 优先级：
 * 1. 显式 role 属性
 * 2. 语义标签自动映射
 */
function extractRole(el: HTMLElement, tag: string): string | undefined {
  // 显式 role 属性
  const explicitRole = el.getAttribute('role')
  if (explicitRole) return explicitRole

  // 语义标签自动映射（仅当与默认角色不同时输出，节省 token）
  if (tag === 'a' && el.hasAttribute('href')) return undefined  // <a> 默认就是 link
  if (tag === 'button') return undefined  // <button> 默认就是 button
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type
    if (type === 'checkbox') return undefined  // 默认 checkbox
    if (type === 'radio') return undefined     // 默认 radio
    if (type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  if (tag === 'textarea') return undefined    // 默认 textbox
  if (tag === 'select') return 'combobox'
  if (tag === 'summary') return 'button'
  if (tag === 'details') return 'group'

  return undefined
}

/**
 * 检查元素是否可见
 *
 * 两种模式共用同一逻辑：display:none / visibility:hidden / offsetParent
 * 区别仅在调用方是否做视口边界检测
 */
function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  // display:none 或 visibility:hidden → 不可见
  if (style.display === 'none' || style.visibility === 'hidden') return false
  // offsetParent 非 null 或 fixed 定位 → 可见
  return el.offsetParent !== null || style.position === 'fixed'
}

/**
 * 检测页面是否有弹窗/遮罩层阻挡交互
 *
 * 检测策略（按优先级）：
 * 1. 原生 dialog[open]
 * 2. ARIA dialog/alertdialog/aria-modal
 * 3. 常见框架弹窗（Bootstrap/Element UI/Ant Design）
 * 4. 通用遮罩层（面积 > 50% 视口）
 */
function hasModalOverlay(doc: Document): boolean {
  // 1. 原生 dialog[open]
  if (doc.querySelector('dialog[open]')) return true

  // 2. ARIA 语义标记
  const ariaSelectors = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
  ]
  for (const sel of ariaSelectors) {
    const el = doc.querySelector(sel) as HTMLElement | null
    if (el && isElementVisible(el)) return true
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
    const el = doc.querySelector(sel) as HTMLElement | null
    if (el && isElementVisible(el)) return true
  }

  // 4. 通用遮罩检测：fixed/absolute 元素覆盖大面积视口
  const overlaySelectors = [
    '[class*="overlay"]',
    '[class*="mask"]',
    '[class*="modal-backdrop"]',
    '[class*="dialog-mask"]',
  ]
  for (const sel of overlaySelectors) {
    const els = doc.querySelectorAll(sel)
    for (const el of els) {
      const htmlEl = el as HTMLElement
      if (!isElementVisible(htmlEl)) continue
      const rect = htmlEl.getBoundingClientRect()
      if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
        return true
      }
    }
  }

  return false
}

/**
 * 提取页面上的错误/状态提示文本
 *
 * 识别方式：
 * - role="alert" 或 aria-live="assertive/polite"
 * - class/id 含 error/alert/toast/notice/warning/tip/message 等关键词
 * - 限制：可见、有文本、长度合理（<200 字符）
 */
function extractAlerts(doc: Document): string[] {
  const ALERT_SELECTORS = [
    '[role="alert"]',
    '[aria-live="assertive"]',
    '[aria-live="polite"]',
  ]

  const results: string[] = []
  const seen = new Set<string>()

  // 1. 语义标记（role=alert, aria-live）
  for (const sel of ALERT_SELECTORS) {
    for (const el of doc.querySelectorAll(sel)) {
      const text = (el as HTMLElement).innerText?.trim()
      if (text && text.length > 0 && text.length < 200 && !seen.has(text)) {
        seen.add(text)
        results.push(text)
      }
    }
  }

  // 2. class/id 含关键词的可见元素
  for (const el of doc.querySelectorAll('[class*="error"], [class*="alert"], [class*="toast"], [class*="notice"], [class*="warning"], [class*="tip"], [id*="error"], [id*="alert"], [id*="toast"]')) {
    const htmlEl = el as HTMLElement
    if (!isElementVisible(htmlEl)) continue
    const text = htmlEl.innerText?.trim()
    if (text && text.length > 2 && text.length < 200 && !seen.has(text)) {
      seen.add(text)
      results.push(text)
    }
  }

  return results.slice(0, 5) // 最多 5 条，避免 token 膨胀
}

function getDirectText(el: HTMLElement): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent?.trim() || ''
    }
  }
  // 直接子节点无文字 → 尝试从子元素中提取（如 <a><span>关注</span></a>）
  if (!text) {
    for (const child of el.children) {
      const childText = (child as HTMLElement).innerText?.trim() || ''
      if (childText) { text = childText; break }
    }
  }
  // 注意：不再 fallback 到 aria-label/title（这些走 ariaLabel 字段独立输出）
  return text.trim()
}

/**
 * 查找表单元素关联的 label 文本
 *
 * 按优先级尝试四种关联方式：
 * 1. <label for="elementId"> — 通过 for 属性关联
 * 2. 父级 <label> — input 嵌套在 label 内
 * 3. aria-labelledby — 指向任意元素的 id
 * 4. 同级 <label> — 同一父容器下的 label（Element UI 等组件库模式）
 */
function findAssociatedLabelText(el: HTMLElement): string | null {
  // 方式 1：label[for="id"]
  const elId = el.id
  if (elId) {
    const label = document.querySelector(`label[for="${CSS.escape(elId)}"]`)
    if (label) {
      const text = label.textContent?.trim()
      if (text) return text
    }
  }

  // 方式 2：父级 <label>
  const parentLabel = el.closest('label')
  if (parentLabel) {
    // 取 label 的直接文本节点（排除 input 自身的文本）
    let text = ''
    for (const node of parentLabel.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent?.trim() || ''
      }
    }
    if (text) return text.slice(0, 100)
  }

  // 方式 3：aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const refEl = document.getElementById(labelledBy)
    if (refEl) {
      const text = refEl.textContent?.trim()
      if (text) return text
    }
  }

  // 方式 4：同级 <label>（Element UI 等组件库模式）
  // 如 <div class="el-form-item"><label>活动名称</label><div>...<input>...</div></div>
  // 从 input 向上查找包含 <label> 子元素的最近容器
  let container: HTMLElement | null = el
  for (let i = 0; i < 5 && container; i++) {
    container = container.parentElement
    if (!container) break
    const label = container.querySelector(':scope > label')
    if (label) {
      const text = label.textContent?.trim()
      if (text) return text
    }
  }

  return null
}

function findLandmarkParent(el: HTMLElement): string | undefined {
  let current = el.parentElement
  while (current) {
    const tag = current.tagName.toLowerCase()
    if (LANDMARK_TAGS.includes(tag)) return tag
    const role = current.getAttribute('role')
    if (role && LANDMARK_ROLES.includes(role)) return role
    current = current.parentElement
  }
  return undefined
}

/**
 * 提取全页面骨架（无元素上限）
 *
 * [need_full] 触发时调用，与视口骨架格式一致，
 * 覆盖所有可交互元素（含视口外），AI 直接用 elementId 定位。
 */
export function extractFullSkeleton(doc: Document): SemanticSkeleton {
  return extractSkeleton(doc, 'full')
}

// ═══════════════════════════════════════════════
// 跨域 iframe 骨架提取（chrome.scripting.executeScript）
// ═══════════════════════════════════════════════


/**
 * 从跨域 iframe 中提取骨架元素
 *
 * 使用 chrome.scripting.executeScript with allFrames: true，
 * 注入自包含的提取函数到每个 frame。
 */
async function extractIframeSkeletons(
  inaccessibleIframes: HTMLIFrameElement[],
  scope: SkeletonScope,
): Promise<SkeletonElement[]> {
  if (!inaccessibleIframes.length) return []

  const vpWidth = window.innerWidth
  const vpHeight = window.innerHeight

  try {
    // 通过 background 中转调用 chrome.scripting.executeScript（content script 无权直接调用）
    const response = await new Promise<{ results?: Array<{ url: string; elements: SkeletonElement[] }>; error?: string }>(resolve => {
      chrome.runtime.sendMessage({
        type: 'extract-iframe-skeleton',
        scope,
        vpWidth: window.innerWidth,
        vpHeight: window.innerHeight,
      }, resolve)
    })

    if (response.error) {
      log.warn('iframe 骨架提取失败', { error: response.error })
      return []
    }

    const results = response.results
    if (!results?.length) return []

    const merged: SkeletonElement[] = []

    for (const data of results) {
      if (!data?.elements?.length) continue
      // 跳过主框架
      if (data.url === window.location.href) continue

      // 通过 URL 匹配 iframe 元素获取 parentLabel
      const iframeEl = inaccessibleIframes.find(f => {
        try { return f.contentWindow?.location?.href === data.url } catch { return false }
      })

      let parentLabel = 'iframe'
      if (iframeEl) {
        parentLabel = iframeEl.id
          || iframeEl.getAttribute('name')
          || (iframeEl.className ? iframeEl.className.split(/\s+/)[0] : '')
          || 'iframe'
      }

      // 调整 ID 前缀避免冲突 + 设置 parent
      for (const el of data.elements) {
        el.id = `f_${el.id}`
        el.parent = `iframe.${parentLabel}`
        merged.push(el)
      }
    }

    log.info('iframe 骨架提取完成', {
      iframeCount: results.filter(r => r.url !== window.location.href).length,
      elements: merged.length,
    })
    return merged
  } catch (err) {
    log.warn('iframe 骨架提取失败', { error: String(err) })
    return []
  }
}

/**
 * 注入到跨域 iframe 的自包含提取函数
 *
 * 不依赖任何外部导入，在 iframe 的隔离上下文中执行。
 */
function iframeExtractFunc(scope: string, vpWidth: number, vpHeight: number): { url: string; elements: unknown[] } {
  const SKIP = 'script,style,noscript,meta,link,br,hr'
  const TAGS = ['a', 'button', 'input', 'select', 'textarea', 'video', 'audio']
  const MAX_HREF_LENGTH = 200
  const MAX_PLACEHOLDER_LENGTH = 50
  let idCounter = 0

  function isClickable(el: HTMLElement): boolean {
    if (TAGS.includes(el.tagName.toLowerCase())) return true
    if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true
    if (el.getAttribute('onclick')) return true
    const role = el.getAttribute('role')
    if (role && ['button', 'link', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio'].includes(role)) return true
    if (el.getAttribute('tabindex')) return true
    try { if (getComputedStyle(el).cursor === 'pointer') return true } catch { /* */ }
    return false
  }

  function isVisible(el: HTMLElement): boolean {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') return false
    return el.offsetParent !== null || s.position === 'fixed'
  }

  function getText(el: HTMLElement): string {
    let t = ''
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) t += n.textContent?.trim() || ''
    }
    if (!t) {
      for (const c of el.children) {
        const ct = (c as HTMLElement).innerText?.trim() || ''
        if (ct) { t = ct; break }
      }
    }
    return t.trim()
  }

  function extract(el: HTMLElement, id: string): Record<string, unknown> | null {
    const tag = el.tagName.toLowerCase()
    const text = getText(el)
    const hasIcon = !!el.querySelector('svg, img, i, [class*="icon"]')
    const isForm = ['input', 'textarea', 'select'].includes(tag)
    const hasFormContent = isForm && (el.getAttribute('placeholder') || (el as HTMLInputElement).value)
    const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || null
    const altText = !ariaLabel ? el.querySelector('img')?.getAttribute('alt') : null
    const ariaLabelValue = ariaLabel || altText || null
    const isContentEditable = el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''
    const isEditor = el.classList.contains('CodeMirror') ||
      el.classList.contains('monaco-editor') ||
      el.classList.contains('ace_editor') ||
      el.classList.contains('bytemd-editor')

    if (!text && !el.getAttribute('role') && !hasIcon && !hasFormContent && !ariaLabelValue && !isEditor && !isContentEditable) return null

    const base: Record<string, unknown> = { id, tag }
    const explicitRole = el.getAttribute('role')
    if (explicitRole) base.role = explicitRole
    else if (tag === 'input') {
      const t = (el as HTMLInputElement).type
      if (t === 'submit' || t === 'reset') base.role = 'button'
      else if (t !== 'checkbox' && t !== 'radio') base.role = 'textbox'
    } else if (tag === 'select') base.role = 'combobox'
    else if (isContentEditable) base.role = 'textbox'

    if (text) base.text = text
    else if (hasFormContent) {
      const v = (el as HTMLInputElement).value
      if (v) base.text = v
    } else if (hasIcon && ariaLabelValue) base.ariaLabel = ariaLabelValue
    else if (hasIcon) base.text = '(icon)'
    if (ariaLabelValue && base.text !== ariaLabelValue) base.ariaLabel = ariaLabelValue
    if (isForm && el.getAttribute('placeholder')) base.placeholder = el.getAttribute('placeholder')!.slice(0, MAX_PLACEHOLDER_LENGTH)

    if (tag === 'a') {
      const href = el.getAttribute('href')
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        try { base.href = new URL(href, el.baseURI).href.slice(0, MAX_HREF_LENGTH) } catch { /* */ }
      }
    }
    if (tag === 'input') {
      const inp = el as HTMLInputElement
      const t = inp.type || 'text'
      if (t !== 'checkbox' && t !== 'radio') base.inputType = t
      if (t !== 'password' && inp.value) base.value = inp.value
      if ((t === 'checkbox' || t === 'radio') && inp.checked) base.checked = true
      if (inp.required) base.required = true
    }
    if (tag === 'textarea') {
      const ta = el as HTMLTextAreaElement
      if (ta.value) base.value = ta.value
      if (ta.required) base.required = true
    }
    if (isContentEditable) {
      const content = el.innerText?.trim() || ''
      if (content) base.value = content
    }
    if (isForm || tag === 'button') {
      const d = (el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true'
      if (d) base.disabled = true
    }
    return base
  }

  // 确保所有元素有 data-skeleton-id
  for (const el of document.body.querySelectorAll(`*:not(${SKIP})`)) {
    if (!(el as HTMLElement).dataset.skeletonId) {
      (el as HTMLElement).dataset.skeletonId = `fi${++idCounter}`
    }
  }

  const elements: Record<string, unknown>[] = []
  for (const el of document.body.querySelectorAll('*')) {
    const htmlEl = el as HTMLElement
    const id = htmlEl.dataset.skeletonId || ''
    if (!id || !isClickable(htmlEl)) continue
    if (!isVisible(htmlEl)) continue
    if (scope === 'viewport') {
      const r = htmlEl.getBoundingClientRect()
      if (r.top >= vpHeight || r.bottom <= 0 || r.left >= vpWidth || r.right <= 0) continue
      if (r.width < 1 || r.height < 1) continue
    }
    const ex = extract(htmlEl, id)
    if (ex) elements.push(ex)
  }

  return { url: location.href, elements }
}
