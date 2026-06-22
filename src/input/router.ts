/**
 * 输入路由器
 *
 * 接收用户输入（语音/文字），唯一预处理是 `/` 命令解析（字符串 split），
 * 其余全部交给 AI 意图检测。
 */

import { Logger } from '@/src/utils/logger'
import { CAPABILITY_DOMAIN_LIST } from './prompts/common'
import type { InputContext, InputResult } from './types'

const log = new Logger('InputRouter')

/** 内置命令列表（不含能力域指令） */
const BUILTIN_COMMANDS = ['stop', 'pause', 'resume', 'list', 'help']

/** 能力域指令 id 集合（用于快速查找） */
const CAPABILITY_IDS = new Set(CAPABILITY_DOMAIN_LIST.map(c => c.id))

export class InputRouter {
  /**
   * 路由用户输入
   *
   * - / 前缀 → 确定性解析，不走 AI
   * - 其余 → 返回 { type: 'ai' } 交给意图检测
   */
  route(ctx: InputContext): InputResult {
    const text = ctx.text.trim()

    // / 前缀 → 确定性解析
    if (text.startsWith('/')) {
      const parsed = this.parseSlashCommand(text)
      if (parsed.isBuiltin) {
        log.info('内置命令', { command: parsed.command, args: parsed.args })
        return { type: 'builtin', command: parsed.command, args: parsed.args }
      }
      if (parsed.isCapability) {
        log.info('能力域指令', { command: parsed.command, args: parsed.args })
        return { type: 'capability', command: parsed.command, args: parsed.args }
      }
      // 非内置 → 未知命令
      log.info('未知命令', { command: parsed.command })
      return { type: 'builtin', command: 'unknown', args: parsed.command }
    }

    // 其余 → AI 意图检测
    return { type: 'ai' }
  }

  /**
   * 解析 / 命令
   *
   * 格式: /命令名 参数
   * 示例: /scroll auto, /navigate https://bilibili.com, /help
   */
  private parseSlashCommand(text: string): {
    isCommand: boolean
    isBuiltin: boolean
    isCapability: boolean
    command: string
    args: string
  } {
    const match = text.match(/^\/(\S+)\s*(.*)/)
    if (!match) {
      return { isCommand: false, isBuiltin: false, isCapability: false, command: '', args: '' }
    }

    const command = match[1]
    const args = match[2].trim()

    return {
      isCommand: true,
      isBuiltin: BUILTIN_COMMANDS.includes(command),
      isCapability: CAPABILITY_IDS.has(command),
      command,
      args,
    }
  }
}
