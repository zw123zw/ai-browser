/**
 * 唤醒词检测器
 *
 * 监听 interim 识别结果，检测是否包含唤醒词
 * 模糊匹配：去标点 + 编辑距离容错
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

export class WakeWordDetector {
  private wakeWord: string
  private wakeWordNormalized: string
  private maxErrors: number

  constructor(wakeWord: string) {
    this.wakeWord = wakeWord
    this.wakeWordNormalized = normalize(wakeWord)
    // 允许的编辑距离：唤醒词每4个字允许1个错误，至少1
    this.maxErrors = Math.max(1, Math.floor(this.wakeWordNormalized.length / 4))
    log.info('唤醒词已设置', { wakeWord, normalized: this.wakeWordNormalized, maxErrors: this.maxErrors })
  }

  /** 更新唤醒词 */
  setWakeWord(word: string): void {
    this.wakeWord = word
    this.wakeWordNormalized = normalize(word)
    this.maxErrors = Math.max(1, Math.floor(this.wakeWordNormalized.length / 4))
    log.info('唤醒词已更新', { wakeWord: word, maxErrors: this.maxErrors })
  }

  /** 获取当前唤醒词 */
  getWakeWord(): string {
    return this.wakeWord
  }

  /**
   * 检查文本是否包含唤醒词
   *
   * 1. 先尝试精确包含匹配（去标点后）
   * 2. 失败则用滑动窗口 + 编辑距离做模糊匹配
   */
  check(text: string): boolean {
    if (!text || !this.wakeWord) return false

    const normalized = normalize(text)
    const wakeLen = this.wakeWordNormalized.length

    // 精确包含
    if (normalized.includes(this.wakeWordNormalized)) {
      log.info('唤醒词精确匹配', { text })
      return true
    }

    // 滑动窗口模糊匹配
    // 窗口大小 = 唤醒词长度 ± maxErrors
    const minWindow = Math.max(1, wakeLen - this.maxErrors)
    const maxWindow = wakeLen + this.maxErrors

    for (let w = minWindow; w <= maxWindow; w++) {
      for (let i = 0; i <= normalized.length - w; i++) {
        const slice = normalized.slice(i, i + w)
        const dist = editDistance(slice, this.wakeWordNormalized)
        if (dist <= this.maxErrors) {
          log.info('唤醒词模糊匹配', { text, slice, distance: dist, maxErrors: this.maxErrors })
          return true
        }
      }
    }

    return false
  }

  /**
   * 从文本中移除唤醒词，返回命令部分
   *
   * 例如："你好，小灵 打开B站" → "打开B站"
   */
  extractCommand(text: string): string {
    if (!text) return ''

    const normalized = normalize(text)
    const wakeLen = this.wakeWordNormalized.length
    const minWindow = Math.max(1, wakeLen - this.maxErrors)
    const maxWindow = wakeLen + this.maxErrors

    // 找到最佳匹配位置
    let bestStart = -1
    let bestEnd = -1
    let bestDist = Infinity

    for (let w = minWindow; w <= maxWindow; w++) {
      for (let i = 0; i <= normalized.length - w; i++) {
        const slice = normalized.slice(i, i + w)
        const dist = editDistance(slice, this.wakeWordNormalized)
        if (dist < bestDist) {
          bestDist = dist
          bestStart = i
          bestEnd = i + w
        }
      }
    }

    if (bestStart === -1 || bestDist > this.maxErrors) {
      return text.trim()
    }

    // 在原始文本中找到对应位置（跳过标点）
    const originalStart = this.normalizedIndexToOriginal(text, bestStart)
    const originalEnd = this.normalizedIndexToOriginal(text, bestEnd)

    const after = text.slice(originalEnd).trim()
    const before = text.slice(0, originalStart).trim()

    log.info('提取命令', { text, before, after, distance: bestDist })
    return after || before
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
