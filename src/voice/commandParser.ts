/**
 * 指令解析器（AI 驱动版）
 *
 * 解析 AI 输出中的 【code】 标记，提取可执行指令。
 * 支持批量解析多条有序指令。
 *
 * 旧版本地正则解析已移除，指令识别完全由 AI 负责。
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('CommandParser')

const CMD_START = '【code】'
const CMD_END = '【/code】'

// ========== 类型定义 ==========

export type CommandType =
  | 'open_site'
  | 'search'
  | 'site_search'
  | 'open_item'
  | 'page_next'
  | 'page_prev'
  | 'video_play'
  | 'video_pause'

/** @deprecated 使用 CommandType 替代 */
export type AutomationAction = CommandType

export interface CommandInfo {
  type: CommandType
  params: string
}

export interface SingleParseResult {
  success: boolean
  command?: CommandInfo
  error?: string
}

export interface BatchParseResult {
  total: number
  commandList: CommandInfo[]
  hasError: boolean
  errorMsg?: string
  plainText?: string
}

// ========== 常量 ==========

const VALID_TYPES: CommandType[] = [
  'open_site',
  'search',
  'site_search',
  'open_item',
  'page_next',
  'page_prev',
  'video_play',
  'video_pause',
]

const NO_PARAM_CMDS: CommandType[] = ['page_next', 'page_prev', 'video_play', 'video_pause']

// ========== 解析函数 ==========

/**
 * 解析单条指令片段
 */
function parseSingleCmd(cmdContent: string): SingleParseResult {
  const content = cmdContent.trim()
  if (!content) {
    return { success: false, error: '指令内容为空' }
  }

  const [type, ...paramArr] = content.split(':')
  const params = paramArr.join(':').trim()

  // 验证指令类型
  if (!VALID_TYPES.includes(type as CommandType)) {
    return { success: false, error: `非法指令类型：${type}` }
  }

  // 验证参数（无参指令不需要参数）
  if (!NO_PARAM_CMDS.includes(type as CommandType) && !params) {
    return { success: false, error: `指令 ${type} 缺少必填参数` }
  }

  return { success: true, command: { type: type as CommandType, params } }
}

/**
 * 批量解析 AI 返回文本，支持多条有序指令
 *
 * @param rawText AI 原始输出
 * @returns 批量解析结果
 */
export function parseBatchCommand(rawText: string): BatchParseResult {
  log.info('开始批量解析指令', { rawText })

  const result: BatchParseResult = {
    total: 0,
    commandList: [],
    hasError: false,
  }

  // 1. 按 CMD_END 分割，提取所有指令块
  const cmdBlocks = rawText.split(CMD_END).filter((blk) => blk.includes(CMD_START))

  // 无指令标记 = 纯对话文本
  if (cmdBlocks.length === 0) {
    result.plainText = rawText.trim()
    log.info('未识别指令，判定为纯对话')
    return result
  }

  // 2. 逐条解析，保留顺序
  for (const block of cmdBlocks) {
    const startIdx = block.indexOf(CMD_START)
    const cmdContent = block.slice(startIdx + CMD_START.length).trim()
    const singleRes = parseSingleCmd(cmdContent)

    if (!singleRes.success) {
      result.hasError = true
      result.errorMsg = singleRes.error
      log.error('单条指令解析失败', singleRes.error)
      continue
    }

    if (singleRes.command) {
      result.commandList.push(singleRes.command)
      result.total++
    }
  }

  log.info('批量解析完成', { total: result.total, hasError: result.hasError })
  return result
}
