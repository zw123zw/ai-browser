/**
 * 语义骨架提取器 + 骨架管理器
 *
 * SkeletonManager: 只在 URL 变化时重新提取骨架，其余时间复用缓存。
 */

import { Logger } from '@/src/utils/logger'
import type { SkeletonElement, SemanticSkeleton } from './types'

const log = new Logger('Skeleton')

/** 地标标签列表 */
const LANDMARK_TAGS = ['nav', 'header', 'main', 'aside', 'footer']
const LANDMARK_ROLES = ['navigation', 'banner', 'main', 'complementary', 'contentinfo']

/**
 * 骨架管理器
 *
 * 只在首次或 URL 变化时重新提取骨架，其余时间复用缓存。
 * 执行 navigate 后需要调用 invalidate() 标记失效。
 */
export class SkeletonManager {
  private lastUrl: string = ''
  private lastSkeleton: SemanticSkeleton | null = null

  /**
   * 获取当前页面骨架
   *
   * URL 未变 → 返回缓存
   * URL 变化 → 重新提取
   */
  getSkeleton(): SemanticSkeleton {
    const currentUrl = window.location.href
    if (currentUrl !== this.lastUrl || !this.lastSkeleton) {
      log.info('URL 变化或首次提取，重新提取骨架', {
        oldUrl: this.lastUrl,
        newUrl: currentUrl,
      })
      this.lastSkeleton = extractSkeleton(document)
      this.lastUrl = currentUrl
    }
    return this.lastSkeleton
  }

  /**
   * 标记骨架失效
   *
   * 在执行 navigate 指令后调用，下次 getSkeleton() 会重新提取。
   */
  invalidate(): void {
    log.info('骨架失效（页面即将跳转）')
    this.lastUrl = ''
    this.lastSkeleton = null
  }

  /** 获取上次缓存的骨架 URL */
  get cachedUrl(): string {
    return this.lastUrl
  }
}

/**
 * 从当前页面提取语义骨架
 */
export function extractSkeleton(doc: Document): SemanticSkeleton {
  const elements: SkeletonElement[] = []
  let idCounter = 0

  const interactiveSelector = 'a, button, input, select, textarea, [onclick], [role="button"], [tabindex]'
  const textSelector = 'h1, h2, h3, h4, h5, h6, p, li, td, th, label'
  const landmarkSelector = 'nav, header, main, aside, footer, [role="navigation"], [role="banner"], [role="main"]'

  const candidates = doc.querySelectorAll(`${interactiveSelector}, ${textSelector}, ${landmarkSelector}`)

  for (const el of candidates) {
    if (!isVisible(el as HTMLElement)) continue

    const id = `e${++idCounter}`
    const element = extractElement(el as HTMLElement, id)
    if (element) {
      element.parent = findLandmarkParent(el as HTMLElement)
      ;(el as HTMLElement).dataset.skeletonId = id
      elements.push(element)
    }
  }

  log.debug('骨架提取完成', { elementCount: elements.length, url: doc.location.href })

  return {
    url: doc.location.href,
    title: doc.title,
    elements,
  }
}

function extractElement(el: HTMLElement, id: string): SkeletonElement | null {
  const tag = el.tagName.toLowerCase()
  const text = getDirectText(el).slice(0, 100)
  const hasIcon = !!el.querySelector('svg, img, i, [class*="icon"]')

  // 无文字 + 非交互元素 + 无 role + 无图标子元素 → 跳过
  if (!text && !isInteractive(el) && !el.getAttribute('role') && !hasIcon) return null

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

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0 && el.children.length === 0) return false
  return true
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return true
  if (el.getAttribute('onclick')) return true
  if (el.getAttribute('role') === 'button') return true
  if (el.getAttribute('tabindex')) return true
  return false
}

function getDirectText(el: HTMLElement): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent?.trim() || ''
    }
  }
  if (!text) {
    text = el.getAttribute('aria-label') || el.getAttribute('title') || ''
  }
  return text.trim()
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
