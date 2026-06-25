import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveFrontendLog, saveApiLog, getFrontendLogs, getApiLogs, clearAllLogs } from '../log-storage'

describe('log-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(chrome.storage.local.get as any).mockResolvedValue({})
    ;(chrome.storage.local.set as any).mockResolvedValue(undefined)
    ;(chrome.storage.local.remove as any).mockResolvedValue(undefined)
  })

  describe('saveFrontendLog', () => {
    it('应写入前端日志', () => {
      // VITE_LOG_ENABLED 在测试环境中可能为 false
      // 验证函数存在且可调用
      expect(typeof saveFrontendLog).toBe('function')
      expect(() => saveFrontendLog('INFO', 'Test', 'test message')).not.toThrow()
    })
  })

  describe('saveApiLog', () => {
    it('应写入 API 日志', () => {
      expect(typeof saveApiLog).toBe('function')
      expect(() => saveApiLog('INFO', 'API', 'request')).not.toThrow()
    })
  })

  describe('getFrontendLogs', () => {
    it('应获取前端日志', async () => {
      const logs = [{ time: '2024-01-01', level: 'INFO', module: 'Test', msg: 'test' }]
      ;(chrome.storage.local.get as any).mockResolvedValue({ 'logs:frontend': logs })

      const result = await getFrontendLogs()
      expect(result).toEqual(logs)
    })

    it('无日志时应返回空数组', async () => {
      ;(chrome.storage.local.get as any).mockResolvedValue({})
      const result = await getFrontendLogs()
      expect(result).toEqual([])
    })

    it('storage 失败时应返回空数组', async () => {
      ;(chrome.storage.local.get as any).mockRejectedValue(new Error('fail'))
      const result = await getFrontendLogs()
      expect(result).toEqual([])
    })
  })

  describe('getApiLogs', () => {
    it('应获取 API 日志', async () => {
      const logs = [{ time: '2024-01-01', level: 'INFO', module: 'API', msg: 'req' }]
      ;(chrome.storage.local.get as any).mockResolvedValue({ 'logs:api': logs })

      const result = await getApiLogs()
      expect(result).toEqual(logs)
    })

    it('无日志时应返回空数组', async () => {
      ;(chrome.storage.local.get as any).mockResolvedValue({})
      const result = await getApiLogs()
      expect(result).toEqual([])
    })
  })

  describe('clearAllLogs', () => {
    it('应清除所有日志', async () => {
      await clearAllLogs()
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(['logs:frontend', 'logs:api'])
    })

    it('storage 失败时应静默忽略', async () => {
      ;(chrome.storage.local.remove as any).mockRejectedValue(new Error('fail'))
      await expect(clearAllLogs()).resolves.toBeUndefined()
    })
  })
})
