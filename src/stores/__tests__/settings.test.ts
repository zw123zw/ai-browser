import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

vi.mock('@/src/storage', () => ({
  DEFAULT_SETTINGS: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModelId: 'model-1',
    models: [{ id: 'model-1', label: 'GPT-4', provider: 'openai', modelName: 'gpt-4', baseUrl: '', apiKey: '' }],
    maxContext: 100,
    maxConversations: 100,
  },
  settingsStorage: {
    getValue: vi.fn().mockResolvedValue(null),
    setValue: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
  },
}))

vi.mock('@/src/utils/storage-sync', () => ({
  defineStorageSync: vi.fn(() => ({
    isApplyingRemote: () => false,
    markSelfWrite: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
  plain: vi.fn((v) => JSON.parse(JSON.stringify(v))),
}))

const { useSettingsStore } = await import('../settings')

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('应有 settings', () => {
    const store = useSettingsStore()
    expect(store.settings).toBeDefined()
  })

  it('应有 ready 状态', () => {
    const store = useSettingsStore()
    expect(store.ready).toBe(false)
  })

  describe('init', () => {
    it('应从 storage 加载设置', async () => {
      const store = useSettingsStore()
      await store.init()

      expect(store.ready).toBe(true)
    })

    it('应处理无效存储数据', async () => {
      const { settingsStorage } = await import('@/src/storage')
      ;(settingsStorage.getValue as any).mockResolvedValue({ invalid: true })

      const store = useSettingsStore()
      await store.init()

      expect(store.ready).toBe(true)
    })
  })

  describe('update', () => {
    it('应合并并持久化', async () => {
      const store = useSettingsStore()
      await store.init()
      await store.update({ maxContext: 200 })

      expect(store.settings.maxContext).toBe(200)
    })
  })
})
