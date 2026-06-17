/**
 * 关键词 HTML 搜索（[need_html] 兜底）
 *
 * 当骨架无法定位目标元素时，用 AI 提供的关键词在整个页面 DOM 中
 * 搜索可交互元素，提取清洗后的 HTML 片段发给 AI 重新分析。
 */

import { Logger } from '@/src/utils/logger'
import { ensureAllSkeletonIds, ensureSkeletonId } from './skeleton-id'

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
  'for',
  'id',
])

/**
 * 根据关键词在整个页面 DOM 搜索可交互元素，返回清洗后的 HTML 片段
 *
 * @param keywords AI 对用户意图分词结果，任一关键词命中即可（OR）
 * @returns 拼接的 HTML 片段，未找到返回 null
 */
export function searchByKeywords(keywords: string[]): string | null {
  if (!keywords.length) {
    log.warn('searchByKeywords: keywords 为空')
    return null
  }

  log.info('关键词 HTML 搜索', { keywords })

  // 全量打标：确保所有元素有 data-skeleton-id（含懒加载元素）
  ensureAllSkeletonIds()

  const matched: string[] = []

  // 主文档搜索
  searchInDoc(document, keywords, matched)

  // iframe 搜索（同源 iframe）
  const iframes = document.querySelectorAll('iframe')
  for (const iframe of iframes) {
    let iframeDoc: Document | null = null
    try { iframeDoc = (iframe as HTMLIFrameElement).contentDocument } catch { continue }
    if (!iframeDoc?.body) continue
    searchInDoc(iframeDoc, keywords, matched)
  }

  if (matched.length === 0) {
    log.warn('关键词搜索未找到匹配元素', { keywords })
    return null
  }

  const result = matched.join('\n')
  log.info('关键词搜索完成', { keywords, matchCount: matched.length, htmlLength: result.length })
  return result
}

/** 在单个文档内搜索匹配关键词的可交互元素（兜底：整个页面，不要可见性判断） */
function searchInDoc(doc: Document, keywords: string[], matched: string[]): void {
  const allElements = doc.body.querySelectorAll('*')
  const addedIds = new Set<string>() // 避免重复添加同一元素

  for (const el of allElements) {
    const htmlEl = el as HTMLElement
    if (!isClickable(htmlEl)) continue
    if (!matchesKeywords(htmlEl, keywords)) continue
    // iframe 元素未被 ensureAllSkeletonIds 覆盖，需要单独打标
    ensureSkeletonId(htmlEl)
    const cleaned = cleanElement(htmlEl)
    if (cleaned) {
      const sid = htmlEl.dataset.skeletonId
      if (sid && !addedIds.has(sid)) {
        matched.push(cleaned)
        addedIds.add(sid)
      }
    }

    // 当 label 匹配时，同时返回它关联的表单元素（input/select/textarea）
    // 让 AI 能看到正确的 elementId 来执行 type/click 等操作
    const tag = htmlEl.tagName.toLowerCase()
    if (tag === 'label') {
      const formEl = findAssociatedFormControl(htmlEl, doc)
      if (formEl) {
        ensureSkeletonId(formEl)
        const formCleaned = cleanElement(formEl)
        if (formCleaned) {
          const formSid = formEl.dataset.skeletonId
          if (formSid && !addedIds.has(formSid)) {
            matched.push(formCleaned)
            addedIds.add(formSid)
          }
        }
      }
    }
  }
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
 * 关键词 OR 模糊匹配
 *
 * 任一关键词在 textContent/aria-label/placeholder/title/value/alt 中出现即命中
 */
function matchesKeywords(el: HTMLElement, keywords: string[]): boolean {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  const ariaLabel = el.getAttribute('aria-label') || ''
  const placeholder = el.getAttribute('placeholder') || ''
  const titleAttr = el.getAttribute('title') || ''
  const value = (el as HTMLInputElement).value || ''
  // 检查子元素的 alt 属性（如 <img alt="头像">）
  const altText = el.querySelector('img')?.getAttribute('alt') || ''

  const sources = [text, ariaLabel, placeholder, titleAttr, value, altText]

  return keywords.some(kw => {
    const normalizedKw = kw.replace(/\s+/g, ' ').trim().toLowerCase()
    return sources.some(s => s.toLowerCase().includes(normalizedKw))
  })
}

/**
 * 查找 label 关联的表单元素（input/select/textarea）
 *
 * 按优先级尝试：
 * 1. label[for="id"] → document.getElementById(id)
 * 2. label 内嵌的 input/select/textarea
 * 3. 同级容器内的 input/select/textarea（Element UI 等组件库模式）
 */
function findAssociatedFormControl(label: HTMLLabelElement, doc: Document): HTMLElement | null {
  const formTags = 'input, select, textarea'

  // 方式 1：for 属性关联
  const forId = label.getAttribute('for')
  if (forId) {
    const target = doc.getElementById(forId)
    if (target && formTags.includes(target.tagName.toLowerCase())) {
      return target as HTMLElement
    }
  }

  // 方式 2：label 内嵌的表单元素
  const inner = label.querySelector(formTags)
  if (inner) return inner as HTMLElement

  // 方式 3：同级容器内的表单元素（Element UI 等组件库模式）
  // label 和 input 在同一个 form-item 容器内
  const parent = label.parentElement
  if (parent) {
    const sibling = parent.querySelector(formTags)
    if (sibling) return sibling as HTMLElement
  }

  return null
}

/**
 * 清洗元素：只保留关键属性，移除 script/style/noscript，递归清洗子元素，压缩空白
 */
function cleanElement(el: HTMLElement): string | null {
  try {
    const clone = cleanNode(el)
    if (!clone) return null

    let html = clone.outerHTML
    // 压缩空白：合并空格、去掉标签间空格、去掉等号两侧空格
    html = html.replace(/\s+/g, ' ')
    html = html.replace(/>\s+</g, '><')
    html = html.replace(/\s*=\s*/g, '=')
    html = html.replace(/\s+>/g, '>')
    html = html.trim()
    return html
  } catch {
    log.warn('cleanElement 失败')
    return null
  }
}

/** 递归清洗单个元素节点 */
function cleanNode(el: HTMLElement): HTMLElement | null {
  const tag = el.tagName.toLowerCase()
  if (['script', 'style', 'noscript'].includes(tag)) return null

  const clone = document.createElement(tag)

  // 只保留关键属性
  for (const attr of Array.from(el.attributes)) {
    if (KEEP_ATTRS.has(attr.name)) {
      clone.setAttribute(attr.name, attr.value)
    }
  }

  // 递归清洗子节点
  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const cleaned = cleanNode(child as HTMLElement)
      if (cleaned) clone.appendChild(cleaned)
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim()
      if (text) clone.appendChild(document.createTextNode(text))
    }
  }

  return clone
}
