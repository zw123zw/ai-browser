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

  const allElements = document.querySelectorAll('*')
  let target: HTMLElement | null = null

  // 1. 搜索包含关键词的元素
  for (const el of allElements) {
    const text = el.textContent?.trim() || ''
    const ariaLabel = el.getAttribute('aria-label') || ''
    const placeholder = el.getAttribute('placeholder') || ''
    const title = el.getAttribute('title') || ''
    const value = (el as HTMLInputElement).value || ''

    if ([text, ariaLabel, placeholder, title, value].some(t => t && t.includes(query))) {
      target = el as HTMLElement
      break
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
