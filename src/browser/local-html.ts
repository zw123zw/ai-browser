/**
 * 局部 HTML 提取器（[need_html] 兜底机制）
 *
 * 当骨架无法定位目标元素时，根据关键词在 DOM 中搜索相关区域，
 * 提取该区域完整子树 HTML 发给 AI 重新分析。
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('LocalHtml')

/**
 * 根据关键词在 DOM 中搜索相关区域，提取局部完整 HTML
 *
 * @param query 搜索关键词（如 "登录按钮"）
 * @returns 局部 HTML 字符串，未找到返回 null
 */
export function extractLocalHtml(query: string): string | null {
  log.info('提取局部 HTML', { query })

  let target: HTMLElement | null = null

  // 1. 优先按骨架 ID 查找（query 如 "e77"）
  if (/^e\d+$/.test(query)) {
    target = document.querySelector<HTMLElement>(`[data-skeleton-id="${query}"]`)
    if (target) log.debug('通过骨架 ID 找到元素', { query })
  }

  // 2. 按文本内容搜索（模糊匹配）
  if (!target) {
    const normalizedQuery = query.replace(/\s+/g, ' ').trim()
    const allElements = document.querySelectorAll('*')

    for (const el of allElements) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      const ariaLabel = el.getAttribute('aria-label') || ''
      const placeholder = el.getAttribute('placeholder') || ''
      const titleAttr = el.getAttribute('title') || ''
      const value = (el as HTMLInputElement).value || ''

      // 长标题用前 30 字符匹配（避免截断导致匹配失败）
      const matchQuery = normalizedQuery.length > 30 ? normalizedQuery.slice(0, 30) : normalizedQuery
      if ([text, ariaLabel, placeholder, titleAttr, value].some(t => t && t.includes(matchQuery))) {
        target = el as HTMLElement
        break
      }
    }
  }

  if (!target) {
    log.warn('未找到包含关键词的元素', { query })
    return null
  }

  // 2. 向上找到合适的容器（3 层父级，提供上下文）
  let container = target
  for (let i = 0; i < 3; i++) {
    if (!container.parentElement) break
    container = container.parentElement
  }

  // 3. 克隆并清理（移除 script/style/noscript）
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())

  const html = clone.outerHTML
  log.debug('局部 HTML 提取成功', { query, htmlLength: html.length })
  return html
}
