/**
 * 日志存储模块
 *
 * 使用 chrome.storage.local 存储日志，支持前端日志和 API 日志分开存储。
 * 仅在 VITE_LOG_ENABLED=true 时生效。
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  time: string
  level: LogLevel
  module: string
  msg: string
}

const KEY_FRONTEND = 'logs:frontend'
const KEY_API = 'logs:api'
const MAX_STORAGE_BYTES = 4 * 1024 * 1024 // 4MB 上限，留 1MB 余量

/** 写入队列，保证同一 key 的写入顺序 */
const writeQueues: Record<string, Promise<void>> = {}

/** 格式化当前时间 YYYY-MM-DD HH:mm:ss */
function formatTime(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 排队写入，保证顺序 */
function enqueueWrite(key: string, entry: LogEntry): void {
  const prev = writeQueues[key] || Promise.resolve()
  writeQueues[key] = prev.then(() => doAppend(key, entry)).catch(() => doAppend(key, entry))
}

/** 实际追加日志 */
async function doAppend(key: string, entry: LogEntry): Promise<void> {
  try {
    const result = await chrome.storage.local.get(key)
    const logs: LogEntry[] = result[key] || []
    logs.push(entry)

    const size = new Blob([JSON.stringify(logs)]).size
    if (size > MAX_STORAGE_BYTES) {
      await chrome.storage.local.set({ [key]: [entry] })
    } else {
      await chrome.storage.local.set({ [key]: logs })
    }
  } catch {
    // storage 写入失败静默忽略
  }
}

/** 写入一条前端日志 */
export function saveFrontendLog(level: LogLevel, module: string, msg: string): void {
  enqueueWrite(KEY_FRONTEND, { time: formatTime(), level, module, msg })
}

/** 写入一条 API 日志 */
export function saveApiLog(level: LogLevel, module: string, msg: string): void {
  enqueueWrite(KEY_API, { time: formatTime(), level, module, msg })
}

/** 获取前端日志 */
export async function getFrontendLogs(): Promise<LogEntry[]> {
  const result = await chrome.storage.local.get(KEY_FRONTEND)
  return result[KEY_FRONTEND] || []
}

/** 获取 API 日志 */
export async function getApiLogs(): Promise<LogEntry[]> {
  const result = await chrome.storage.local.get(KEY_API)
  return result[KEY_API] || []
}

/** 清除所有日志 */
export async function clearAllLogs(): Promise<void> {
  await chrome.storage.local.remove([KEY_FRONTEND, KEY_API])
}

/** 将日志条目格式化为文本行 */
function formatLogLines(logs: LogEntry[]): string {
  return logs.map((e) => `[${e.time}] [${e.level}] [${e.module}] ${e.msg}`).join('\n')
}

/** 触发浏览器下载日志文件 */
export async function downloadLogs(): Promise<void> {
  const [frontendLogs, apiLogs] = await Promise.all([getFrontendLogs(), getApiLogs()])

  const date = new Date().toISOString().slice(0, 10)
  downloadAsFile(`frontend-${date}.log`, formatLogLines(frontendLogs))
  downloadAsFile(`api-${date}.log`, formatLogLines(apiLogs))
}

/** 通过 Blob + <a> 触发下载 */
function downloadAsFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
