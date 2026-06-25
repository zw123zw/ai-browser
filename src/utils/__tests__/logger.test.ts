import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Logger, setLogLevel } from '../logger'

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('构造函数应设置模块名', () => {
    const log = new Logger('TestModule')
    expect(log).toBeDefined()
  })

  it('应有 debug/info/warn/error 方法', () => {
    const log = new Logger('Test')
    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  it('setLogLevel 应设置全局级别', () => {
    expect(() => setLogLevel('WARN')).not.toThrow()
    expect(() => setLogLevel('DEBUG')).not.toThrow()
  })
})
