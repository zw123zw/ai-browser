import { vi } from 'vitest'

// chrome.runtime mock
const chromeMock = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn().mockReturnValue(false),
    },
    connect: vi.fn().mockReturnValue({
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
    }),
    id: 'test-extension-id',
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    getManifest: vi.fn().mockReturnValue({ version: '0.1.1' }),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn(),
    remove: vi.fn(),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([]),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    setIcon: vi.fn(),
  },
  permissions: {
    request: vi.fn().mockResolvedValue(true),
    contains: vi.fn().mockResolvedValue(true),
  },
}

// @ts-ignore
globalThis.chrome = chromeMock

// SpeechRecognition mock
class MockSpeechRecognition {
  continuous = false
  interimResults = false
  lang = 'zh-CN'
  onresult: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
}

// @ts-ignore
globalThis.SpeechRecognition = MockSpeechRecognition
// @ts-ignore
globalThis.webkitSpeechRecognition = MockSpeechRecognition

// speechSynthesis mock
globalThis.speechSynthesis = {
  speak: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  getVoices: vi.fn().mockReturnValue([]),
  pending: false,
  speaking: false,
  paused: false,
  onvoiceschanged: null,
} as any

// URL.createObjectURL mock
globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url')
globalThis.URL.revokeObjectURL = vi.fn()

// matchMedia mock
globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))
