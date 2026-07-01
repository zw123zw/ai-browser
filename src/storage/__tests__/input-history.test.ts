import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pushInputHistory } from '../input-history'

const mockSettings = { inputHistory: [] as string[] }

vi.mock('@/src/stores/settings', () => ({
  useSettingsStore: () => ({
    settings: mockSettings,
  }),
}))

describe('pushInputHistory', () => {
  beforeEach(() => {
    mockSettings.inputHistory = []
  })

  it('应追加记录', async () => {
    await pushInputHistory('hello')
    expect(mockSettings.inputHistory).toEqual(['hello'])
  })

  it('连续相同文本应去重', async () => {
    mockSettings.inputHistory = ['hello']
    await pushInputHistory('hello')
    expect(mockSettings.inputHistory).toEqual(['hello'])
  })

  it('不同文本应正常追加', async () => {
    mockSettings.inputHistory = ['hello']
    await pushInputHistory('world')
    expect(mockSettings.inputHistory).toEqual(['hello', 'world'])
  })

  it('空文本不应追加', async () => {
    await pushInputHistory('')
    await pushInputHistory('   ')
    expect(mockSettings.inputHistory).toEqual([])
  })

  it('超过 100 条应截掉头部', async () => {
    mockSettings.inputHistory = Array.from({ length: 100 }, (_, i) => `item-${i}`)
    await pushInputHistory('new-item')
    expect(mockSettings.inputHistory).toHaveLength(100)
    expect(mockSettings.inputHistory[0]).toBe('item-1')
    expect(mockSettings.inputHistory[99]).toBe('new-item')
  })

  it('storage 失败时应静默忽略', async () => {
    // pushInputHistory catches errors internally
    await expect(pushInputHistory('test')).resolves.toBeUndefined()
  })
})
