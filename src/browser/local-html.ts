/**
 * 关键词 HTML 搜索（[need_html] 兜底）
 *
 * 当骨架无法定位目标元素时，用 AI 提供的关键词在整个页面 DOM 中
 * 搜索可交互元素，提取清洗后的 HTML 片段发给 AI 重新分析。
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('LocalHtml')

/** 只保留这些属性，其余全部移除 */
const KEEP_ATTRS = new Set([
  'data-skeleton-id',
  'href',
  'src',
  'type',
  'name',
  'placeholder',
  'value',
  'role',
  'aria-label',
  'title',
])

/**
 * 根据关键词在整个页面 DOM 搜索可交互元素，返回清洗后的 HTML 片段
 *
 * @param keywords AI 对用户意图分词结果，所有关键词必须全部命中（AND）
 * @returns 拼接的 HTML 片段，未找到返回 null
 */
export function searchByKeywords(keywords: string[]): string | null {
  if (!keywords.length) {
    log.warn('searchByKeywords: keywords 为空')
    return null
  }

  log.info('关键词 HTML 搜索', { keywords })

  const allElements = document.body.querySelectorAll('*')
  const matched: string[] = []

  for (const el of allElements) {
    const htmlEl = el as HTMLElement

    // 1. 只保留可交互元素
    if (!isClickable(htmlEl)) continue

    // 2. 可见性检查
    if (!isElementVisible(htmlEl)) continue

    // 3. 关键词 AND 匹配
    if (!matchesKeywords(htmlEl, keywords)) continue

    // 4. 清洗：只保留元素本身，清洗属性
    const cleaned = cleanElement(htmlEl)
    if (cleaned) matched.push(cleaned)
  }

  if (matched.length === 0) {
    log.warn('关键词搜索未找到匹配元素', { keywords })
    return null
  }

  const result = matched.join('\n')
  log.info('关键词搜索完成', { keywords, matchCount: matched.length, htmlLength: result.length })
  return result
}

/**
 * 检查元素是否可交互（复用骨架的 isClickable 逻辑）
 */
function isClickable(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()

  if (['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'details'].includes(tag)) return true
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true
  if (el.getAttribute('onclick')) return true

  const role = el.getAttribute('role')
  if (role && ['button', 'link', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio'].includes(role)) return true
  if (el.getAttribute('tabindex')) return true

  try {
    const style = window.getComputedStyle(el)
    if (style.cursor === 'pointer') return true
  } catch {
    // getComputedStyle 可能失败，忽略
  }

  return false
}

/**
 * 检查元素是否可见
 */
function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return el.offsetParent !== null || style.position === 'fixed'
}

/**
 * 关键词 AND 模糊匹配
 *
 * 每个关键词都必须在 textContent/aria-label/placeholder/title/value 中出现
 */
function matchesKeywords(el: HTMLElement, keywords: string[]): boolean {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  const ariaLabel = el.getAttribute('aria-label') || ''
  const placeholder = el.getAttribute('placeholder') || ''
  const titleAttr = el.getAttribute('title') || ''
  const value = (el as HTMLInputElement).value || ''

  const sources = [text, ariaLabel, placeholder, titleAttr, value]

  return keywords.every(kw => {
    const normalizedKw = kw.replace(/\s+/g, ' ').trim().toLowerCase()
    return sources.some(s => s.toLowerCase().includes(normalizedKw))
  })
}

/**
 * 清洗元素：只保留关键属性，移除 script/style/noscript，压缩空白
 */
function cleanElement(el: HTMLElement): string | null {
  try {
    const clone = el.cloneNode(false) as HTMLElement

    // 只保留关键属性
    const attrs = Array.from(clone.attributes)
    for (const attr of attrs) {
      if (!KEEP_ATTRS.has(attr.name)) {
        clone.removeAttribute(attr.name)
      }
    }

    // 保留子节点（递归清洗）
    for (const child of el.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as HTMLElement
        const childTag = childEl.tagName.toLowerCase()
        if (['script', 'style', 'noscript'].includes(childTag)) continue
        clone.appendChild(childEl.cloneNode(true))
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim()
        if (text) clone.appendChild(document.createTextNode(text))
      }
    }

    let html = clone.outerHTML
    // 压缩空白
    html = html.replace(/\s+/g, ' ').replace(/> </g, '><')
    return html
  } catch {
    log.warn('cleanElement 失败')
    return null
  }
}
