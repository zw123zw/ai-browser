/**
 * 翻译结果解析器
 *
 * 从 AI 回复中提取翻译结果。
 * 三层容错解析：直接 JSON.parse → 正则提取 [...] 块 → 逐行提取对象。
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('TranslateParser')

/** 单条翻译结果 */
export interface TranslateResult {
  id: string
  translated: string
}

/**
 * 从 AI 回复中提取翻译结果（自动翻译场景）
 *
 * AI 可能返回：
 * 1. 纯 JSON 数组 — [{"id":"e1","translated":"你好"}]
 * 2. JSON 前后有说明文字 — "以下是翻译结果：[...]"
 * 3. 非标准格式 — 逐行包含 {"id":...,"translated":...}
 */
export function parseTranslateResponse(raw: string): TranslateResult[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  // 策略 1：直接 JSON.parse
  try {
    const arr = JSON.parse(trimmed)
    if (Array.isArray(arr)) {
      const results = validateResults(arr)
      if (results.length > 0) {
        log.debug('解析成功（直接 JSON）', { count: results.length })
        return results
      }
    }
  } catch { /* 继续 */ }

  // 策略 2：正则提取 [...] 块
  const jsonBlocks = trimmed.match(/\[[\s\S]*?\]/g)
  if (jsonBlocks) {
    // 从最后一个匹配开始尝试（最可能是完整数组）
    for (let i = jsonBlocks.length - 1; i >= 0; i--) {
      try {
        const arr = JSON.parse(jsonBlocks[i])
        if (Array.isArray(arr)) {
          const results = validateResults(arr)
          if (results.length > 0) {
            log.debug('解析成功（JSON 块提取）', { count: results.length })
            return results
          }
        }
      } catch { /* 继续 */ }
    }
  }

  // 策略 3：逐行提取 {"id":"eN","translated":"..."} 对象
  const results: TranslateResult[] = []
  const lineRegex = /\{\s*"id"\s*:\s*"(e\d+)"\s*,\s*"translated"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
  let m: RegExpExecArray | null
  while ((m = lineRegex.exec(trimmed)) !== null) {
    results.push({
      id: m[1],
      translated: unescapeJson(m[2]),
    })
  }

  if (results.length > 0) {
    log.debug('解析成功（逐行提取）', { count: results.length })
  } else {
    log.warn('解析失败，未找到翻译结果', { preview: trimmed.slice(0, 200) })
  }

  return results
}

/**
 * 从 AI 回复中提取单条翻译结果（划词翻译场景）
 *
 * 直接返回 AI 回复的文本内容（去除可能的前后说明文字）。
 */
export function parseSingleTranslation(raw: string): string {
  const trimmed = raw.trim()

  // 尝试从 JSON 中提取
  try {
    const obj = JSON.parse(trimmed)
    if (typeof obj === 'object' && obj !== null && typeof obj.translated === 'string') {
      return obj.translated
    }
  } catch { /* 继续 */ }

  // 尝试从 {translated: "..."} 中提取
  const m = trimmed.match(/"translated"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (m) return unescapeJson(m[1])

  // 去除常见的前后缀说明
  let text = trimmed
  text = text.replace(/^(以下是|这是|翻译结果[：:])\s*/i, '')
  text = text.replace(/\s*(希望|以上).*$/i, '')

  return text
}

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

/** 验证并过滤结果数组 */
function validateResults(arr: unknown[]): TranslateResult[] {
  return arr.filter(
    (item): item is TranslateResult =>
      typeof item === 'object' && item !== null &&
      typeof (item as any).id === 'string' &&
      typeof (item as any).translated === 'string' &&
      /^e\d+$/.test((item as any).id),
  )
}

/** JSON 字符串反转义 */
function unescapeJson(s: string): string {
  try {
    return JSON.parse(`"${s}"`)
  } catch {
    return s
  }
}
