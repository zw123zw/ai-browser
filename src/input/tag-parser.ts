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
import type { Command } from '@/src/browser/types'

const log = new Logger('TagParser')

/** 提取结果 */
export interface ExtractedTags {
  /** [chat] 内的文本（Phase 1 纯聊天回复时有值） */
  chatText?: string
  /** 提取到的 [command] 列表 */
  commands?: Command[]
  /** 是否包含 [action] 标记 */
  isAction: boolean
  /** 提取到的 [need_full] */
  needFull?: boolean
  /** 提取到的 [need_input]（AI 需要用户输入信息） */
  needInput?: { message: string; type?: string }
  /** 是否包含 [FILE:xxx]...[/FILE] 文件标签 */
  hasFileTags: boolean
  /** 文件标签详情（用于日志） */
  fileTagDetails?: {
    filename: string
    hasClosingTag: boolean
    contentLength: number
  }
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
    hasFileTags: false,
    hasAnyTag: false,
    rawText,
  }

  // [FILE:xxx]...[/FILE] 文件标签检测（兼容大小写、可选空格、无闭合标签）
  const fileMatch = rawText.match(/\[FILE:\s*([^\]]+)\]\r?\n?([\s\S]*?)(?:\[\/FILE\]|$)/i)
  if (fileMatch) {
    result.hasFileTags = true
    result.hasAnyTag = true
    result.fileTagDetails = {
      filename: fileMatch[1].trim(),
      hasClosingTag: rawText.includes('[/FILE]'),
      contentLength: fileMatch[2].length,
    }
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

  // [action] 提取（无内容标签）
  if (rawText.includes('[action]')) {
    result.isAction = true
    result.hasAnyTag = true
  }

  // [need_full] 提取 — 无需 JSON，检测到标签即触发
  if (rawText.includes('[need_full]')) {
    result.needFull = true
    result.hasAnyTag = true
  }

  // [need_input] 提取 — JSON 内容标签，AI 需要用户输入信息（凭据、验证码等）
  const needInputMatch = rawText.match(/\[need_input\]([\s\S]*?)\[\/need_input\]/)
    || rawText.match(/\[need_input\](\{[\s\S]*\})/)
  if (needInputMatch) {
    try {
      const parsed = JSON.parse(needInputMatch[1].trim())
      result.needInput = { message: parsed.message || '需要您的输入', type: parsed.type }
    } catch {
      result.needInput = { message: needInputMatch[1].trim() }
    }
    result.hasAnyTag = true
  }

  return result
}

/**
 * 判断 Phase 1 的回复是否是纯聊天（无任何操作标签）
 *
 * 纯聊天 = 有文本内容 + 没有 [action]/[command]/[need_full]/[FILE] 标签
 */
export function isChatOnlyReply(tags: ExtractedTags): boolean {
  // 有操作类标签或文件标签 → 不是纯聊天
  if (tags.isAction || tags.commands?.length || tags.needFull || tags.needInput || tags.hasFileTags) {
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
