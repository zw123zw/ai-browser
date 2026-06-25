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
  conversationStorage: {
    getValue: vi.fn().mockResolvedValue(null),
    setValue: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
  },
  queuedTaskStorage: {
    getValue: vi.fn().mockResolvedValue(null),
    setValue: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
  },
}))

vi.mock('@/src/storage/input-history', () => ({
  pushInputHistory: vi.fn(),
}))

vi.mock('@/src/adapters', () => ({
  createAdapter: vi.fn(() => ({
    name: 'openai',
    chat: vi.fn().mockImplementation(async (opts: any, onChunk: Function) => {
      onChunk({ delta: '你好', done: false })
      onChunk({ done: true })
    }),
  })),
}))

vi.mock('@/src/utils/storage-sync', () => ({
  defineStorageSync: vi.fn(() => ({
    isApplyingRemote: () => false,
    markSelfWrite: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
  plain: vi.fn((v) => JSON.parse(JSON.stringify(v))),
}))

vi.mock('@/src/utils/cache', () => ({
  checkAndAutoClear: vi.fn(),
}))

vi.mock('@/src/composables/usePipeline', () => ({
  abortPipeline: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../settings', () => ({
  useSettingsStore: vi.fn(() => ({
    settings: {
      defaultModelId: 'model-1',
      maxContext: 100,
      models: [{ id: 'model-1', label: 'GPT-4', provider: 'openai', modelName: 'gpt-4' }],
    },
  })),
}))

const { useConversationsStore } = await import('../conversations')

describe('useConversationsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('初始状态 conversation 应为 null', () => {
    const store = useConversationsStore()
    expect(store.conversation).toBeNull()
  })

  describe('init', () => {
    it('应从 storage 加载会话', async () => {
      const { conversationStorage } = await import('@/src/storage')
      const storedConv = {
        id: 'conv-1',
        title: '测试会话',
        messages: [],
        modelId: 'model-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      ;(conversationStorage.getValue as any).mockResolvedValue(storedConv)

      const store = useConversationsStore()
      await store.init()

      expect(store.conversation).toBeDefined()
      expect(store.ready).toBe(true)
    })

    it('无存储数据时应创建默认会话', async () => {
      const store = useConversationsStore()
      await store.init()

      expect(store.conversation).toBeDefined()
      expect(store.conversation!.title).toBeDefined()
    })

    it('应清理残留的 streaming 消息', async () => {
      const { conversationStorage } = await import('@/src/storage')
      const storedConv = {
        id: 'conv-1',
        title: '测试',
        messages: [
          { id: 'msg1', role: 'assistant', content: '', timestamp: Date.now(), status: 'streaming' },
        ],
        modelId: 'model-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      ;(conversationStorage.getValue as any).mockResolvedValue(storedConv)

      const store = useConversationsStore()
      await store.init()

      expect(store.conversation!.messages[0].status).toBe('done')
    })
  })

  describe('clearCurrent', () => {
    it('应清空消息和上下文', async () => {
      const { conversationStorage } = await import('@/src/storage')
      ;(conversationStorage.getValue as any).mockResolvedValue({
        id: 'conv-1',
        title: '测试',
        messages: [{ id: 'msg1', role: 'user', content: 'hello', timestamp: Date.now(), status: 'done' }],
        modelId: 'model-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      const store = useConversationsStore()
      await store.init()
      await store.clearCurrent()

      expect(store.conversation!.messages).toHaveLength(0)
      expect(store.contextCleared).toBe(true)
    })
  })

  describe('deleteMessage', () => {
    it('应删除指定消息', async () => {
      const { conversationStorage } = await import('@/src/storage')
      ;(conversationStorage.getValue as any).mockResolvedValue({
        id: 'conv-1',
        title: '测试',
        messages: [
          { id: 'msg1', role: 'user', content: 'hello', timestamp: Date.now(), status: 'done' },
          { id: 'msg2', role: 'assistant', content: 'hi', timestamp: Date.now(), status: 'done' },
        ],
        modelId: 'model-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })

      const store = useConversationsStore()
      await store.init()
      store.deleteMessage('msg1')

      expect(store.conversation!.messages).toHaveLength(1)
      expect(store.conversation!.messages[0].id).toBe('msg2')
    })

    it('删除不存在的消息应安全处理', async () => {
      const store = useConversationsStore()
      await store.init()

      expect(() => store.deleteMessage('nonexistent')).not.toThrow()
    })
  })

  describe('abort', () => {
    it('应中止当前请求', () => {
      const store = useConversationsStore()
      expect(() => store.abort()).not.toThrow()
    })
  })
})
