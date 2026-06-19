/**
 * 统一日志系统
 *
 * 使用方式：
 *   const log = new Logger('Voice')
 *   log.info('识别完成', { text, confidence })
 *   log.error('请求失败', error)
 *
 * 日志写入 chrome.storage.local（仅 debug 包），不输出到 console。
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

/** 全局最低日志级别，默认 DEBUG（全部输出） */
let globalMinLevel: LogLevel = 'DEBUG'

/** 设置全局最低日志级别 */
export function setLogLevel(level: LogLevel) {
  globalMinLevel = level
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

/** 缓存的日志写入函数 */
let cachedSaveFrontendLog: ((level: LogLevel, module: string, msg: string) => void) | null = null
let cachedSaveApiLog: ((level: LogLevel, module: string, msg: string) => void) | null = null
let logStorageLoaded = false

/** 加载 log-storage 模块 */
function loadLogStorage() {
  if (logStorageLoaded) return
  logStorageLoaded = true
  import('./log-storage').then((mod) => {
    cachedSaveFrontendLog = mod.saveFrontendLog
    cachedSaveApiLog = mod.saveApiLog
  }).catch(() => {})
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

    if (!import.meta.env.VITE_LOG_ENABLED) return

    const msg = formatArgs(args)

    if (!logStorageLoaded) loadLogStorage()

    // API 模块和 Adapter 模块都写入 api 日志
    if (this.module === 'API' || this.module.startsWith('Adapter')) {
      cachedSaveApiLog?.(level, this.module, msg)
    } else {
      cachedSaveFrontendLog?.(level, this.module, msg)
    }
  }
}
