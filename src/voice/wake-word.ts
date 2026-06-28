/**
 * 唤醒词检测器
 *
 * 统一方法 matchWakeWord：滑动窗口 + 编辑距离
 * 返回 { matched, command }：
 *   matched=true, command="" → 纯唤醒词
 *   matched=true, command="打开B站" → 唤醒词+命令
 *   matched=false → 不包含唤醒词
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('WakeWord')

/** 去除标点和空格，只保留中文/英文/数字 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s,，。.!！?？、;；:：""''''「」『』【】\(\)\[\]\{\}—–\-_~～…·​]/g, '')
}

/** 计算两个字符串的编辑距离 */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

/** 匹配结果 */
export interface WakeWordMatch {
  /** 是否匹配到唤醒词 */
  matched: boolean
  /** 唤醒词之后的命令部分（为空表示纯唤醒词） */
  command: string
}

export class WakeWordDetector {
  private wakeWord: string
  private wakeWordNormalized: string
  private maxErrors: number
  private maxErrorsInterim: number

  constructor(wakeWord: string) {
    this.wakeWord = wakeWord
    this.wakeWordNormalized = normalize(wakeWord)
    // final: 每 4 个字允许 1 个错误，至少 1
    this.maxErrors = Math.max(1, Math.floor(this.wakeWordNormalized.length / 4))
    // interim: 每 4 个字允许 1 个错误，至少 1
    this.maxErrorsInterim = Math.max(1, Math.floor(this.wakeWordNormalized.length / 4))
    log.info('唤醒词已设置', { wakeWord, normalized: this.wakeWordNormalized, maxErrors: this.maxErrors, maxErrorsInterim: this.maxErrorsInterim })
  }

  setWakeWord(word: string): void {
    this.wakeWord = word
    this.wakeWordNormalized = normalize(word)
    this.maxErrors = Math.max(1, Math.floor(this.wakeWordNormalized.length / 4))
    this.maxErrorsInterim = Math.max(1, Math.floor(this.wakeWordNormalized.length / 4))
    log.info('唤醒词已更新', { wakeWord: word, maxErrors: this.maxErrors, maxErrorsInterim: this.maxErrorsInterim })
  }

  getWakeWord(): string {
    return this.wakeWord
  }

  /**
   * 统一匹配方法
   *
   * @param isInterim true=用更宽松的阈值（interim 结果不完整）
   */
  matchWakeWord(text: string, isInterim = false): WakeWordMatch {
    if (!text || !this.wakeWord) return { matched: false, command: '' }

    const normalized = normalize(text)
    const wakeLen = this.wakeWordNormalized.length
    const threshold = isInterim ? this.maxErrorsInterim : this.maxErrors
    const minWindow = Math.max(1, wakeLen - threshold)
    const maxWindow = wakeLen + threshold

    let bestStart = -1
    let bestEnd = -1
    let bestDist = Infinity
    let bestLenDiff = Infinity

    for (let w = minWindow; w <= maxWindow; w++) {
      for (let i = 0; i <= normalized.length - w; i++) {
        const slice = normalized.slice(i, i + w)
        const dist = editDistance(slice, this.wakeWordNormalized)
        const lenDiff = Math.abs(w - wakeLen)
        if (dist < bestDist || (dist === bestDist && lenDiff < bestLenDiff)) {
          bestDist = dist
          bestStart = i
          bestEnd = i + w
          bestLenDiff = lenDiff
        }
      }
    }

    if (bestStart === -1 || bestDist > threshold) {
      return { matched: false, command: '' }
    }

    const originalEnd = this.normalizedIndexToOriginal(text, bestEnd)
    const command = text.slice(originalEnd).trim()

    log.info('唤醒词匹配', { text, distance: bestDist, threshold, isInterim, command: command || '(纯唤醒词)' })
    return { matched: true, command }
  }

  /** normalized 索引 → 原始文本索引 */
  private normalizedIndexToOriginal(text: string, normalizedIdx: number): number {
    let count = 0
    for (let i = 0; i < text.length; i++) {
      if (count === normalizedIdx) return i
      const ch = text[i].toLowerCase()
      if (!/[\s,，。.!！?？、;；:：""''''「」『』【】\(\)\[\]\{\}—–\-_~～…·​]/.test(ch)) {
        count++
      }
    }
    return text.length
  }
}
