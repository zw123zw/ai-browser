/**
 * 统一日志系统
 *
 * 使用方式：
 *   const log = new Logger('Voice')
 *   log.info('识别完成', { text, confidence })
 *   log.error('请求失败', error)
 *
 * 输出格式：[14:32:05] [INFO] [Voice] 识别完成 { text: "打开B站", confidence: 0.92 }
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: '#888',
  INFO: '#1890ff',
  WARN: '#faad14',
  ERROR: '#ff4d4f',
}

/** 全局最低日志级别，默认 DEBUG（全部输出） */
let globalMinLevel: LogLevel = 'DEBUG'

/** 设置全局最低日志级别 */
export function setLogLevel(level: LogLevel) {
  globalMinLevel = level
}

/** 获取当前时间字符串 HH:mm:ss */
function timeStr(): string {
  const d = new Date()
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

/** 格式化参数：对象展开，Error 取 message+stack */
function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a, null, 2)
        } catch {
          return String(a)
        }
      }
      return String(a)
    })
    .join(' ')
}

export class Logger {
  private module: string

  constructor(module: string) {
    this.module = module
  }

  debug(...args: unknown[]) {
    this.log('DEBUG', ...args)
  }

  info(...args: unknown[]) {
    this.log('INFO', ...args)
  }

  warn(...args: unknown[]) {
    this.log('WARN', ...args)
  }

  error(...args: unknown[]) {
    this.log('ERROR', ...args)
  }

  private log(level: LogLevel, ...args: unknown[]) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[globalMinLevel]) return

    const time = timeStr()
    const prefix = `[${time}] [${level}] [${this.module}]`
    const msg = formatArgs(args)
    const color = LEVEL_COLORS[level]

    // 使用 console 原生方法，带颜色
    const style = `color:${color};font-weight:bold`

    switch (level) {
      case 'DEBUG':
        console.debug(`%c${prefix}`, style, msg)
        break
      case 'INFO':
        console.info(`%c${prefix}`, style, msg)
        break
      case 'WARN':
        console.warn(`%c${prefix}`, style, msg)
        break
      case 'ERROR':
        console.error(`%c${prefix}`, style, msg)
        break
    }
  }
}
