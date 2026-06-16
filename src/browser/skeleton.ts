/**
 * 语义骨架提取器 + 骨架管理器
 *
 * 每次调用 getSkeleton() 都重新提取可视窗口内的可点击骨架。
 * 不缓存、不监听 DOM 变化 — 简单可靠，永不过期。
 *
 * 核心原则：从可视窗口的顶层容器开始，递归扫描所有子元素，
 * 只要可点击（a/button/input/有点击事件/cursor:pointer）就提取。
 */

import { Logger } from '@/src/utils/logger'
import { INTERACTIVE_TAGS } from './types'
import type { SkeletonElement, SemanticSkeleton } from './types'

const log = new Logger('Skeleton')

/** 地标标签列表（用于 parent 字段标注） */
const LANDMARK_TAGS = ['nav', 'header', 'main', 'aside', 'footer']
const LANDMARK_ROLES = ['navigation', 'banner', 'main', 'complementary', 'contentinfo']

/** 骨架最大元素数（减少 token 消耗） */
const MAX_SKELETON_ELEMENTS = 200

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
    const skeleton = extractSkeleton(document)
    log.info('骨架提取（viewport）', {
      url: skeleton.url,
      elements: skeleton.elements.length,
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
 * 从当前页面可视窗口内提取可点击元素骨架
 *
 * 1. querySelectorAll('*') 获取所有元素
 * 2. 过滤可交互元素（a/button/input/onclick/cursor:pointer 等）
 * 3. 检查可见性（display:none/visibility:hidden/offsetParent）
 * 4. 检查是否在视口内（垂直+水平）
 * 5. 过滤空文本 + 按 parent+text 去重
 */
export function extractSkeleton(doc: Document): SemanticSkeleton {
  const elements: SkeletonElement[] = []
  const domParentIdMap = new Map<string, string>()
  const existingIds = new Map<string, boolean>()
  let idCounter = 0
  let scannedCount = 0

  // 统计已有最大 ID 编号，避免新旧 ID 冲突
  const allElements = doc.body.querySelectorAll('*')
  for (const el of allElements) {
    const existingId = (el as HTMLElement).dataset.skeletonId
    if (existingId) {
      const num = parseInt(existingId.slice(1), 10)
      if (!isNaN(num) && num > idCounter) idCounter = num
    }
  }

  // 嵌套函数：闭包访问 idCounter
  function extractFromDoc(
    doc: Document, vpOffsetX: number, vpOffsetY: number,
    forceParent?: string,
  ): void {
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const allEls = doc.body.querySelectorAll('*')

    for (const el of allEls) {
      const htmlEl = el as HTMLElement
      const id = htmlEl.dataset.skeletonId || `e${++idCounter}`
      htmlEl.dataset.skeletonId = id
      existingIds.set(id, true)

      if (!isClickable(htmlEl)) continue
      if (!isElementVisible(htmlEl)) continue

      const rect = htmlEl.getBoundingClientRect()
      const top = rect.top + vpOffsetY, bottom = rect.bottom + vpOffsetY
      const left = rect.left + vpOffsetX, right = rect.right + vpOffsetX
      if (top >= viewportHeight || bottom <= 0) continue
      if (left >= viewportWidth || right <= 0) continue
      if (rect.width < 1 || rect.height < 1) continue

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

  // iframe 提取（同源 iframe 内元素，parent 标记为 iframe 标识）
  const iframes = doc.querySelectorAll('iframe')
  for (const iframe of iframes) {
    const iframeEl = iframe as HTMLIFrameElement
    let iframeDoc: Document | null = null
    try { iframeDoc = iframeEl.contentDocument } catch { continue }
    if (!iframeDoc?.body) continue

    const iframeRect = iframeEl.getBoundingClientRect()
    if (iframeRect.width < 1 || iframeRect.height < 1) continue

    const iframeLabel = iframeEl.id
      || (iframeEl.className ? iframeEl.className.split(/\s+/)[0] : '')
      || iframeEl.getAttribute('name')
      || 'iframe'

    scannedCount += iframeDoc.body.querySelectorAll('*').length
    extractFromDoc(iframeDoc, iframeRect.left, iframeRect.top, `iframe.${iframeLabel}`)
  }

  // 过滤空文本元素 + 父子同文本去重（保留子级）+ 同级去重
  const elMap = new Map<string, SkeletonElement>()
  for (const el of elements) elMap.set(el.id, el)

  const parentsToRemove = new Set<string>()
  for (const htmlEl of allElements) {
    const sId = (htmlEl as HTMLElement).dataset.skeletonId
    if (!sId) continue
    const el = elMap.get(sId)
    if (!el || !el.text) continue
    for (const child of htmlEl.children) {
      const cId = (child as HTMLElement).dataset?.skeletonId
      if (!cId) continue
      const childEl = elMap.get(cId)
      if (childEl && childEl.text === el.text) {
        parentsToRemove.add(sId)
        break
      }
    }
  }

  const seenByParent = new Map<string, Set<string>>()
  const filtered = elements.filter(el => {
    if (parentsToRemove.has(el.id)) return false
    if (!el.text && !['a', 'button', 'input', 'select', 'textarea'].includes(el.tag) && !el.role) return false
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
  const final = filtered.length > MAX_SKELETON_ELEMENTS ? filtered.slice(0, MAX_SKELETON_ELEMENTS) : filtered

  log.info('骨架提取完成', {
    scannedCount,
    rawCount: elements.length,
    filteredCount: filtered.length,
    finalCount: final.length,
    truncated: filtered.length > MAX_SKELETON_ELEMENTS,
    url: doc.location.href,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    scrollY: window.scrollY,
  })

  return { url: doc.location.href, title: doc.title, elements: final }
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

  return false
}

function extractElement(el: HTMLElement, id: string): SkeletonElement | null {
  const tag = el.tagName.toLowerCase()
  const text = getDirectText(el)
  const hasIcon = !!el.querySelector('svg, img, i, [class*="icon"]')

  // 无文字 + 无 role + 无图标子元素 → 跳过
  // 但 input/textarea 有 placeholder 或 value 时保留（如手机号输入框只有 placeholder）
  const isFormElement = ['input', 'textarea', 'select'].includes(tag)
  const hasFormContent = isFormElement && (
    el.getAttribute('placeholder') || (el as HTMLInputElement).value
  )
  if (!text && !el.getAttribute('role') && !hasIcon && !hasFormContent) return null

  const base: SkeletonElement = { id, tag }

  // 有文字用文字，无文字但有图标子元素标记为图标按钮
  if (text) {
    base.text = text
  } else if (hasIcon) {
    base.text = '(icon)'
  }
  if (el instanceof HTMLAnchorElement && el.href) base.href = el.href
  if (el instanceof HTMLImageElement && el.src) base.src = el.src
  if (el instanceof HTMLInputElement) {
    base.type = el.type
    if (el.name) base.name = el.name
    if (el.placeholder) base.placeholder = el.placeholder
    if (el.value) base.value = el.value
  }
  if (el instanceof HTMLTextAreaElement) {
    if (el.placeholder) base.placeholder = el.placeholder
    if (el.value) base.value = el.value
  }
  if (el.getAttribute('role')) base.role = el.getAttribute('role')!
  if (el.getAttribute('aria-label')) base.ariaLabel = el.getAttribute('aria-label')!
  if (el.getAttribute('title')) base.title = el.getAttribute('title')!
  if (el.dataset.testid) base.class = `[data-testid="${el.dataset.testid}"]`

  // 交互元素补充属性：button 的 type，带 onclick/tabindex 的元素的 role
  if (tag === 'button' && el.getAttribute('type')) base.type = el.getAttribute('type')!
  if (!base.role && (el.getAttribute('onclick') || el.getAttribute('tabindex'))) {
    base.role = el.getAttribute('role') || 'button'
  }

  return base
}

/** 检查元素是否可见 */
function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  // display:none 或 visibility:hidden → 不可见
  if (style.display === 'none' || style.visibility === 'hidden') return false
  // offsetParent 非 null 或 fixed 定位 → 可见
  return el.offsetParent !== null || style.position === 'fixed'
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
  if (!text) {
    text = el.getAttribute('aria-label') || el.getAttribute('title') || ''
  }
  return text.trim().slice(0, 100)
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
