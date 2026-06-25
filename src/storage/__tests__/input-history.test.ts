import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pushInputHistory } from '../input-history'

vi.mock('../index', () => ({
  inputHistoryStorage: {
    getValue: vi.fn().mockResolvedValue([]),
    setValue: vi.fn().mockResolvedValue(undefined),
  },
}))

import { inputHistoryStorage } from '../index'

describe('pushInputHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应追加记录', async () => {
    ;(inputHistoryStorage.getValue as any).mockResolvedValue([])

    await pushInputHistory('hello')

    expect(inputHistoryStorage.setValue).toHaveBeenCalledWith(['hello'])
  })

  it('连续相同文本应去重', async () => {
    ;(inputHistoryStorage.getValue as any).mockResolvedValue(['hello'])

    await pushInputHistory('hello')

    expect(inputHistoryStorage.setValue).not.toHaveBeenCalled()
  })

  it('不同文本应正常追加', async () => {
    ;(inputHistoryStorage.getValue as any).mockResolvedValue(['hello'])

    await pushInputHistory('world')

    expect(inputHistoryStorage.setValue).toHaveBeenCalledWith(['hello', 'world'])
  })

  it('空文本不应追加', async () => {
    await pushInputHistory('')
    await pushInputHistory('   ')

    expect(inputHistoryStorage.setValue).not.toHaveBeenCalled()
  })

  it('超过 100 条应截掉头部', async () => {
    const history = Array.from({ length: 100 }, (_, i) => `item-${i}`)
    ;(inputHistoryStorage.getValue as any).mockResolvedValue(history)

    await pushInputHistory('new-item')

    const setCall = (inputHistoryStorage.setValue as any).mock.calls[0][0]
    expect(setCall).toHaveLength(100)
    expect(setCall[0]).toBe('item-1')
    expect(setCall[99]).toBe('new-item')
  })

  it('storage 失败时应静默忽略', async () => {
    ;(inputHistoryStorage.getValue as any).mockRejectedValue(new Error('context invalidated'))

    await expect(pushInputHistory('test')).resolves.toBeUndefined()
  })
})
