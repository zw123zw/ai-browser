/**
 * 全页骨架提取（[need_full] 兜底）
 *
 * 当视口骨架无法定位目标元素时，AI 输出 [need_full] 标签，
 * 系统提取全页面所有可交互元素的骨架（与视口骨架格式一致），
 * AI 直接使用 elementId 生成指令。
 */

import { Logger } from '@/src/utils/logger'
import { extractFullSkeleton, SkeletonManager } from './skeleton'

const log = new Logger('LocalHtml')

/**
 * 提取全页骨架，返回 JSON 字符串
 *
 * [need_full] 触发时调用，替代旧的关键词 HTML 搜索。
 * 与视口骨架格式一致（id/tag/text/parent），无元素上限。
 *
 * @returns JSON 字符串，未找到返回 null
 */
export function extractFullPageSkeleton(): string | null {
  log.info('提取全页骨架')

  const skeleton = extractFullSkeleton(document)

  if (skeleton.elements.length === 0) {
    log.warn('全页骨架提取完成，无元素')
    return null
  }

  const result = JSON.stringify(skeleton)
  log.info('全页骨架提取完成', {
    elements: skeleton.elements.length,
    jsonLength: result.length,
  })
  return result
}

/**
 * 异步提取全页骨架（含跨域 iframe 内元素）
 *
 * [need_full] 触发时调用，使用 chrome.scripting.executeScript
 * 注入提取函数到不可访问的 iframe 中，合并结果。
 */
export async function extractFullPageSkeletonAsync(): Promise<string | null> {
  log.info('提取全页骨架（含 iframe）')

  const manager = new SkeletonManager()
  const skeleton = await manager.getFullSkeletonWithIframes()

  if (skeleton.elements.length === 0) {
    log.warn('全页骨架提取完成，无元素')
    return null
  }

  const result = JSON.stringify(skeleton)
  log.info('全页骨架提取完成', {
    elements: skeleton.elements.length,
    jsonLength: result.length,
  })
  return result
}
