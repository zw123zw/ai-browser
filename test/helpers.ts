import { vi } from 'vitest'

/**
 * 创建 mock StreamChunk 流
 * 用于测试 AI 适配器的流式响应
 *
 * @example
 * ```ts
 * const mockChat = mockStreamChunks([
 *   { content: '你好', done: false },
 *   { content: '', done: true },
 * ])
 * await adapter.chat(opts, onChunk)
 * expect(onChunk).toHaveBeenCalledTimes(2)
 * ```
 */
export function mockStreamChunks(chunks: any[]) {
  return vi.fn().mockImplementation(async (_opts: any, onChunk: (chunk: any) => void) => {
    for (const chunk of chunks) {
      onChunk(chunk)
    }
  })
}

/**
 * 创建 mock chrome.tabs.query 返回值
 *
 * @example
 * ```ts
 * mockTabsQuery([{ id: 1, title: 'Google', url: 'https://google.com' }])
 * ```
 */
export function mockTabsQuery(tabs: any[]) {
  ;(chrome.tabs.query as any).mockResolvedValue(tabs)
}

/**
 * 创建可见的 DOM 元素（自动 mock 可见性和视口位置）
 *
 * @example
 * ```ts
 * const btn = createVisibleElement('button', {}, '登录')
 * // btn 已 appendChild 到 document.body，且可见、在视口内
 * ```
 */
export function createVisibleElement(
  tag: string,
  attrs: Record<string, string> = {},
  textContent?: string,
): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value)
  }
  if (textContent) {
    el.textContent = textContent
  }
  document.body.appendChild(el)

  Object.defineProperty(el, 'offsetParent', {
    get: () => document.body,
    configurable: true,
  })

  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 10,
    left: 10,
    bottom: 30,
    right: 50,
    width: 40,
    height: 20,
    x: 10,
    y: 10,
    toJSON: () => {},
  })

  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: 'block',
    visibility: 'visible',
    cursor: 'auto',
  } as CSSStyleDeclaration)

  return el
}

/**
 * 创建不可见的 DOM 元素
 */
export function createHiddenElement(
  tag: string,
  attrs: Record<string, string> = {},
  textContent?: string,
): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value)
  }
  if (textContent) {
    el.textContent = textContent
  }
  document.body.appendChild(el)

  Object.defineProperty(el, 'offsetParent', {
    get: () => null,
    configurable: true,
  })

  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 10,
    left: 10,
    bottom: 30,
    right: 50,
    width: 40,
    height: 20,
    x: 10,
    y: 10,
    toJSON: () => {},
  })

  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: 'none',
    visibility: 'visible',
    cursor: 'auto',
  } as CSSStyleDeclaration)

  return el
}

/**
 * 创建视口外的 DOM 元素
 */
export function createOffscreenElement(
  tag: string,
  attrs: Record<string, string> = {},
  textContent?: string,
): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value)
  }
  if (textContent) {
    el.textContent = textContent
  }
  document.body.appendChild(el)

  Object.defineProperty(el, 'offsetParent', {
    get: () => document.body,
    configurable: true,
  })

  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: -100,
    left: 10,
    bottom: -80,
    right: 50,
    width: 40,
    height: 20,
    x: 10,
    y: -100,
    toJSON: () => {},
  })

  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: 'block',
    visibility: 'visible',
    cursor: 'auto',
  } as CSSStyleDeclaration)

  return el
}

/**
 * mock wxt/storage
 *
 * @example
 * ```ts
 * vi.mock('wxt/storage', () => mockWxtStorage())
 * ```
 */
export function mockWxtStorage(initialData: Record<string, any> = {}) {
  const store = { ...initialData }
  return {
    storage: {
      defineItem: vi.fn((key: string, opts?: { fallback?: any }) => ({
        getValue: vi.fn().mockResolvedValue(store[key] ?? opts?.fallback ?? null),
        setValue: vi.fn().mockImplementation(async (value: any) => {
          store[key] = value
        }),
        watch: vi.fn(),
        removeValue: vi.fn().mockImplementation(async () => {
          delete store[key]
        }),
      })),
    },
  }
}

/**
 * 创建 mock fetch 响应
 */
export function mockFetchResponse(data: any, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
    headers: new Headers(),
    body: {
      getReader: vi.fn().mockReturnValue({
        read: vi.fn()
          .mockResolvedValueOnce({ value: new TextEncoder().encode(JSON.stringify(data)), done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        releaseLock: vi.fn(),
      }),
    },
  })
}

/**
 * 创建 mock SSE 流式 fetch 响应
 *
 * @example
 * ```ts
 * const response = mockSSEResponse([
 *   'data: {"choices":[{"delta":{"content":"你"}}]}',
 *   'data: {"choices":[{"delta":{"content":"好"}}]}',
 *   'data: [DONE]',
 * ])
 * ```
 */
export function mockSSEResponse(lines: string[]) {
  const encoder = new TextEncoder()
  let index = 0

  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader: vi.fn().mockReturnValue({
        read: vi.fn().mockImplementation(async () => {
          if (index >= lines.length) {
            return { value: undefined, done: true }
          }
          const line = lines[index++] + '\n'
          return { value: encoder.encode(line), done: false }
        }),
        releaseLock: vi.fn(),
      }),
    },
  })
}
