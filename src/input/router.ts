/**
 * 输入路由器
 *
 * 接收用户输入（语音/文字），唯一预处理是 `/` 命令解析（字符串 split），
 * 其余全部交给 AI 意图检测。
 */

import { Logger } from '@/src/utils/logger'
import type { InputContext, InputResult } from './types'

const log = new Logger('InputRouter')

/** 内置命令列表 */
const BUILTIN_COMMANDS = ['stop', 'pause', 'resume', 'list', 'help']

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
      // 非内置 → 当作技能触发（零 AI）
      log.info('技能命令', { command: parsed.command, args: parsed.args })
      return { type: 'skill', skillName: parsed.command, skillUserText: parsed.args }
    }

    // 其余 → AI 意图检测
    return { type: 'ai' }
  }

  /**
   * 解析 / 命令
   *
   * 格式: /命令名 参数
   * 示例: /翻译 中文你好
   */
  private parseSlashCommand(text: string): {
    isCommand: boolean
    isBuiltin: boolean
    command: string
    args: string
  } {
    const match = text.match(/^\/(\S+)\s*(.*)/)
    if (!match) {
      return { isCommand: false, isBuiltin: false, command: '', args: '' }
    }

    const command = match[1]
    const args = match[2].trim()

    return {
      isCommand: true,
      isBuiltin: BUILTIN_COMMANDS.includes(command),
      command,
      args,
    }
  }
}
