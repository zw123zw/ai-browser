/**
 * AI 标签提取器
 *
 * 核心设计：从 AI 自然语言回复中提取标签，不要求 AI 只输出标签。
 *
 * AI 回复可能是：
 *   "好的，我来帮你点击登录按钮。\n\n[command]{"action":"click","elementId":"e3"}[/command]"
 *
 * 提取器用正则从任意文本中找到 [tag]...[/tag] 并解析 JSON。
 */

import { Logger } from '@/src/utils/logger'
import type { Command, NeedHtmlRequest } from '@/src/browser/types'

const log = new Logger('TagParser')

/** 提取结果 */
export interface ExtractedTags {
  /** [chat] 内的文本（Phase 1 纯聊天回复时有值） */
  chatText?: string
  /** 提取到的 [command] 列表 */
  commands?: Command[]
  /** 提取到的 [skill] */
  skill?: { name: string; userText: string }
  /** 是否包含 [action] 标记 */
  isAction: boolean
  /** 提取到的 [need_html] */
  needHtml?: NeedHtmlRequest
  /** 提取到的 [steps] 步骤预告 */
  steps?: string[]
  /** 是否提取到了任何标签 */
  hasAnyTag: boolean
  /** 原始文本 */
  rawText: string
}

/**
 * 从 AI 回复中提取所有标签
 *
 * 支持标签嵌入在自然语言中，如：
 * "我来帮你操作。\n\n[command]{"action":"click"}[/command]"
 */
export function extractTags(rawText: string): ExtractedTags {
  const result: ExtractedTags = {
    isAction: false,
    hasAnyTag: false,
    rawText,
  }

  // [chat] 提取 — 先匹配闭合标签，匹配不到则取 [chat] 后的整个内容
  const chatMatch = rawText.match(/\[chat\]([\s\S]*?)\[\/chat\]/)
    || rawText.match(/\[chat\]([\s\S]+)/)
  if (chatMatch) {
    try {
      const parsed = JSON.parse(chatMatch[1])
      result.chatText = parsed.text || chatMatch[1].trim()
    } catch {
      result.chatText = chatMatch[1].trim()
    }
    result.hasAnyTag = true
  }

  // [command] 提取（支持多条）— 先匹配闭合标签，匹配不到则取 [command] 后的整个 JSON 对象
  const cmdMatches = [...rawText.matchAll(/\[command\]([\s\S]*?)\[\/command\]/g)]
  const cmdFallback = cmdMatches.length > 0 ? cmdMatches : [...rawText.matchAll(/\[command\](\{[\s\S]*\})/g)]
  if (cmdFallback.length > 0) {
    const commands: Command[] = []
    for (const m of cmdFallback) {
      try {
        commands.push(JSON.parse(m[1].trim()))
      } catch {
        log.warn('command JSON 解析失败', { raw: m[1].slice(0, 100) })
      }
    }
    if (commands.length > 0) {
      result.commands = commands
      result.hasAnyTag = true
    }
  }

  // [skill] 提取 — 先匹配闭合标签，匹配不到则取 [skill] 后的整个 JSON 对象
  const skillMatch = rawText.match(/\[skill\]([\s\S]*?)\[\/skill\]/)
    || rawText.match(/\[skill\](\{[\s\S]*\})/)
  if (skillMatch) {
    try {
      const d = JSON.parse(skillMatch[1].trim())
      result.skill = { name: d.name, userText: d.userText || '' }
      result.hasAnyTag = true
    } catch {
      log.warn('skill JSON 解析失败', { raw: skillMatch[1].slice(0, 100) })
    }
  }

  // [action] 提取（无内容标签）
  if (rawText.includes('[action]')) {
    result.isAction = true
    result.hasAnyTag = true
  }

  // [need_html] 提取 — 先匹配闭合标签，匹配不到则取 [need_html] 后的整个 JSON 对象
  const htmlMatch = rawText.match(/\[need_html\]([\s\S]*?)\[\/need_html\]/)
    || rawText.match(/\[need_html\](\{[\s\S]*\})/)
  if (htmlMatch) {
    try {
      result.needHtml = JSON.parse(htmlMatch[1].trim())
      result.hasAnyTag = true
    } catch {
      log.warn('need_html JSON 解析失败，尝试容错提取', { raw: htmlMatch[1].slice(0, 200) })
      // 容错：尝试提取 keywords、reason、description 字段
      const keywords = htmlMatch[1].match(/"keywords"\s*:\s*(\[[^\]]*\])/)?.[1]
      const reason = htmlMatch[1].match(/"reason"\s*:\s*"([^"]*)"/)?.[1]
      const description = htmlMatch[1].match(/"description"\s*:\s*"([^"]*)"/)?.[1]
      if (keywords && description) {
        try {
          result.needHtml = { keywords: JSON.parse(keywords), reason: reason || '', description }
          result.hasAnyTag = true
          log.info('need_html 容错提取成功', result.needHtml)
        } catch {
          log.warn('need_html 容错提取也失败了')
        }
      }
    }
  }

  // [steps] 提取 — 步骤预告，步骤名用空格隔开；先匹配闭合标签，匹配不到则取 [steps] 后到行尾
  const stepsMatch = rawText.match(/\[steps\]([\s\S]*?)\[\/steps\]/)
    || rawText.match(/\[steps\](.+?)(?:\n|$)/)
  if (stepsMatch) {
    const steps = stepsMatch[1].trim().split(/\s+/).filter(Boolean)
    if (steps.length > 0) {
      result.steps = steps
      result.hasAnyTag = true
    }
  }

  return result
}

/**
 * 判断 Phase 1 的回复是否是纯聊天（无任何操作标签）
 *
 * 纯聊天 = 有文本内容 + 没有 [action]/[command]/[skill]/[need_html] 标签
 */
export function isChatOnlyReply(tags: ExtractedTags): boolean {
  // 有操作类标签 → 不是纯聊天
  if (tags.isAction || tags.commands?.length || tags.skill || tags.needHtml) {
    return false
  }
  // 有 [chat] 标签 → 是纯聊天
  if (tags.chatText) {
    return true
  }
  // 没有任何标签 → AI 直接回复了自然语言，当作纯聊天
  if (!tags.hasAnyTag && tags.rawText.trim()) {
    return true
  }
  return false
}

/**
 * 获取 Phase 1 的聊天回复文本
 *
 * 优先取 [chat] 标签内容，没有则取原始文本（AI 直接回复的情况）
 */
export function getChatText(tags: ExtractedTags): string {
  if (tags.chatText) return tags.chatText
  // AI 直接回复了自然语言（没有标签），用原始文本
  return tags.rawText.trim()
}
