import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SkeletonManager,
  extractSkeleton,
  extractFullSkeleton,
  type SkeletonScope,
} from './skeleton'

// Mock 依赖
vi.mock('@/src/utils/logger', () => {
  return {
    Logger: class MockLogger {
      info = vi.fn()
      debug = vi.fn()
      warn = vi.fn()
      error = vi.fn()
      constructor(module: string) {}
    },
  }
})

vi.mock('./types', () => ({
  INTERACTIVE_TAGS: ['a', 'button', 'input', 'select', 'textarea', 'video', 'audio', 'label', 'summary', 'details'],
}))

vi.mock('./skeleton-id', () => ({
  ensureAllSkeletonIds: vi.fn(),
}))

// DOM 辅助函数
function createElement(
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
  return el
}

// 通用 mock 辅助
function mockElement(el: HTMLElement, options: { visible?: boolean; inViewport?: boolean } = {}) {
  const { visible = true, inViewport = true } = options

  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: inViewport ? 10 : -100,
    left: 10,
    bottom: inViewport ? 30 : -80,
    right: 50,
    width: 40,
    height: 20,
    x: 10,
    y: inViewport ? 10 : -100,
    toJSON: () => {},
  })

  Object.defineProperty(el, 'offsetParent', {
    get: () => visible ? document.body : null,
    configurable: true,
  })

  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: visible ? 'block' : 'none',
    visibility: 'visible',
    cursor: 'auto',
  } as CSSStyleDeclaration)
}

describe('SkeletonManager', () => {
  let manager: SkeletonManager

  beforeEach(() => {
    manager = new SkeletonManager()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('getSkeleton', () => {
    it('应返回视口骨架', () => {
      const button = createElement('button', {}, 'Click')
      document.body.appendChild(button)
      mockElement(button)

      const skeleton = manager.getSkeleton()

      expect(skeleton).toHaveProperty('url')
      expect(skeleton).toHaveProperty('title')
      expect(skeleton).toHaveProperty('elements')
      expect(skeleton).toHaveProperty('viewport')
      expect(skeleton).toHaveProperty('scroll')
      expect(skeleton).toHaveProperty('hasModal')
      expect(skeleton).toHaveProperty('loading')
      expect(skeleton).toHaveProperty('totalInteractive')
      expect(skeleton).toHaveProperty('truncated')
      expect(Array.isArray(skeleton.elements)).toBe(true)
    })
  })

  describe('getFullSkeleton', () => {
    it('应返回全页面骨架', () => {
      const link = createElement('a', { href: 'https://example.com' }, 'Link')
      document.body.appendChild(link)
      mockElement(link, { inViewport: false })

      const skeleton = manager.getFullSkeleton()

      expect(skeleton).toHaveProperty('url')
      expect(skeleton).toHaveProperty('title')
      expect(skeleton).toHaveProperty('elements')
      expect(skeleton.elements.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('invalidate', () => {
    it('应是空操作（viewport 模式无缓存）', () => {
      expect(() => manager.invalidate()).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('应是空操作', () => {
      expect(() => manager.dispose()).not.toThrow()
    })
  })

  describe('cachedUrl', () => {
    it('应返回空字符串', () => {
      expect(manager.cachedUrl).toBe('')
    })
  })
})

describe('extractSkeleton', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('应提取可点击按钮', () => {
    const button = createElement('button', {}, 'Submit')
    document.body.appendChild(button)
    mockElement(button)
    button.dataset.skeletonId = 'e1'

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.elements.length).toBeGreaterThan(0)
    const submitBtn = skeleton.elements.find((el) => el.text === 'Submit')
    expect(submitBtn).toBeDefined()
    expect(submitBtn?.tag).toBe('button')
  })

  it('应提取带 href 的链接', () => {
    const link = createElement('a', { href: 'https://example.com' }, 'Example')
    document.body.appendChild(link)
    mockElement(link)
    link.dataset.skeletonId = 'e2'

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.elements.length).toBeGreaterThan(0)
    const exampleLink = skeleton.elements.find((el) => el.text === 'Example')
    expect(exampleLink).toBeDefined()
    expect(exampleLink?.tag).toBe('a')
    expect(exampleLink?.href).toBe('https://example.com/')
  })

  it('应提取 input 元素', () => {
    const input = createElement('input', { placeholder: 'Enter name', type: 'text' })
    document.body.appendChild(input)
    mockElement(input)
    input.dataset.skeletonId = 'e3'

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.elements.length).toBeGreaterThan(0)
    const nameInput = skeleton.elements.find((el) => el.tag === 'input')
    expect(nameInput).toBeDefined()
    expect(nameInput?.placeholder).toBe('Enter name')
    expect(nameInput?.inputType).toBe('text')
  })

  it('应跳过不可见元素', () => {
    const button = createElement('button', {}, 'Hidden')
    document.body.appendChild(button)
    mockElement(button, { visible: false })
    button.dataset.skeletonId = 'e4'

    const skeleton = extractSkeleton(document, 'viewport')

    const hiddenBtn = skeleton.elements.find((el) => el.text === 'Hidden')
    expect(hiddenBtn).toBeUndefined()
  })

  it('应跳过视口外元素（viewport 模式）', () => {
    const button = createElement('button', {}, 'Offscreen')
    document.body.appendChild(button)
    mockElement(button, { inViewport: false })
    button.dataset.skeletonId = 'e5'

    const skeleton = extractSkeleton(document, 'viewport')

    const offscreenBtn = skeleton.elements.find((el) => el.text === 'Offscreen')
    expect(offscreenBtn).toBeUndefined()
  })

  it('应包含视口外元素（full 模式）', () => {
    const button = createElement('button', {}, 'Offscreen')
    document.body.appendChild(button)
    mockElement(button, { inViewport: false })
    button.dataset.skeletonId = 'e6'

    const skeleton = extractSkeleton(document, 'full')

    const offscreenBtn = skeleton.elements.find((el) => el.text === 'Offscreen')
    expect(offscreenBtn).toBeDefined()
  })

  it('应提取 cursor:pointer 元素', () => {
    const div = createElement('div', {}, 'Clickable')
    document.body.appendChild(div)
    mockElement(div)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      cursor: 'pointer',
    } as CSSStyleDeclaration)
    div.dataset.skeletonId = 'e7'

    const skeleton = extractSkeleton(document, 'viewport')

    const clickableDiv = skeleton.elements.find((el) => el.text === 'Clickable')
    expect(clickableDiv).toBeDefined()
  })

  it('应提取 role=button 元素', () => {
    const div = createElement('div', { role: 'button' }, 'Custom Button')
    document.body.appendChild(div)
    mockElement(div)
    div.dataset.skeletonId = 'e8'

    const skeleton = extractSkeleton(document, 'viewport')

    const customBtn = skeleton.elements.find((el) => el.text === 'Custom Button')
    expect(customBtn).toBeDefined()
    expect(customBtn?.role).toBe('button')
  })

  it('应限制 viewport 模式元素数量', () => {
    for (let i = 0; i < 250; i++) {
      const button = createElement('button', {}, `Button ${i}`)
      document.body.appendChild(button)
      mockElement(button)
      button.dataset.skeletonId = `e${i}`
    }

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.elements.length).toBeLessThanOrEqual(200)
    expect(skeleton.truncated).toBe(true)
  })

  it('应提取页面 alerts', () => {
    const alert = createElement('div', { role: 'alert' }, 'Error occurred')
    document.body.appendChild(alert)
    mockElement(alert)

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.alerts).toBeDefined()
    expect(skeleton.alerts).toContain('Error occurred')
  })

  it('应返回 URL 和 title', () => {
    Object.defineProperty(document, 'location', {
      value: { href: 'https://example.com/page' },
      writable: true,
    })
    Object.defineProperty(document, 'title', {
      value: 'Test Page',
      writable: true,
    })

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.url).toBe('https://example.com/page')
    expect(skeleton.title).toBe('Test Page')
  })

  it('应返回 viewport 和 scroll 信息', () => {
    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.viewport).toBeDefined()
    expect(skeleton.viewport.width).toBe(window.innerWidth)
    expect(skeleton.viewport.height).toBe(window.innerHeight)
    expect(skeleton.scroll).toBeDefined()
    expect(skeleton.scroll.y).toBe(window.scrollY)
    expect(skeleton.scroll.height).toBe(document.documentElement.scrollHeight)
  })

  it('应返回 hasModal 状态', () => {
    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.hasModal).toBe(false)
  })

  it('应检测 dialog[open] 弹窗', () => {
    const dialog = document.createElement('dialog')
    dialog.open = true
    document.body.appendChild(dialog)
    mockElement(dialog)

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.hasModal).toBe(true)
  })

  it('应返回 loading 状态', () => {
    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.loading).toBe(false)
  })

  it('应返回 totalInteractive 统计', () => {
    const button = createElement('button', {}, 'Btn')
    document.body.appendChild(button)
    mockElement(button)
    button.dataset.skeletonId = 'e1'

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.totalInteractive).toBeGreaterThanOrEqual(1)
  })

  it('应返回 focusedElement', () => {
    const input = createElement('input', { type: 'text' })
    document.body.appendChild(input)
    mockElement(input)
    input.dataset.skeletonId = 'e1'
    input.focus()

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.focusedElement).toBe('e1')
  })
})

describe('SkeletonElement 字段提取', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('role 字段', () => {
    it('应提取显式 role 属性', () => {
      const div = createElement('div', { role: 'tab' }, 'Tab')
      document.body.appendChild(div)
      mockElement(div)
      div.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === 'Tab')

      expect(el?.role).toBe('tab')
    })

    it('应为 select 提取 combobox role', () => {
      const select = document.createElement('select')
      select.innerHTML = '<option>A</option>'
      document.body.appendChild(select)
      mockElement(select)
      select.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'select')

      expect(el?.role).toBe('combobox')
    })
  })

  describe('ariaLabel 字段', () => {
    it('应独立提取 aria-label（不合并进 text）', () => {
      const button = createElement('button', { 'aria-label': '搜索' })
      const svg = document.createElement('svg')
      button.appendChild(svg)
      document.body.appendChild(button)
      mockElement(button)
      button.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'button')

      expect(el?.ariaLabel).toBe('搜索')
      expect(el?.text).toBeUndefined()
    })

    it('应提取 title 属性作为 ariaLabel', () => {
      const button = createElement('button', { title: '关闭' })
      const svg = document.createElement('svg')
      button.appendChild(svg)
      document.body.appendChild(button)
      mockElement(button)
      button.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'button')

      expect(el?.ariaLabel).toBe('关闭')
    })

    it('文字按钮不输出 ariaLabel（与 text 相同时）', () => {
      const button = createElement('button', { 'aria-label': '登录' }, '登录')
      document.body.appendChild(button)
      mockElement(button)
      button.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === '登录')

      expect(el?.ariaLabel).toBeUndefined()
    })
  })

  describe('href 字段', () => {
    it('应提取 <a> 标签的 href', () => {
      const link = createElement('a', { href: '/login' }, '登录')
      document.body.appendChild(link)
      mockElement(link)
      link.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === '登录')

      expect(el?.href).toBeDefined()
      expect(el?.href).toContain('/login')
    })

    it('应跳过 javascript: href', () => {
      const link = createElement('a', { href: 'javascript:void(0)' }, 'Link')
      document.body.appendChild(link)
      mockElement(link)
      link.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === 'Link')

      expect(el?.href).toBeUndefined()
    })

    it('应跳过 # href', () => {
      const link = createElement('a', { href: '#' }, 'Link')
      document.body.appendChild(link)
      mockElement(link)
      link.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === 'Link')

      expect(el?.href).toBeUndefined()
    })
  })

  describe('inputType 字段', () => {
    it('应提取 input type', () => {
      const input = createElement('input', { type: 'email', placeholder: 'Email' })
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.inputType).toBe('email')
    })

    it('checkbox 不输出 inputType', () => {
      const input = createElement('input', { type: 'checkbox' })
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.inputType).toBeUndefined()
    })
  })

  describe('value 字段', () => {
    it('应提取 input 的 value', () => {
      const input = createElement('input', { type: 'text', placeholder: 'Name' }) as HTMLInputElement
      input.value = 'John'
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.value).toBe('John')
    })

    it('密码框不提取 value', () => {
      const input = createElement('input', { type: 'password', placeholder: 'Password' }) as HTMLInputElement
      input.value = 'secret123'
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.value).toBeUndefined()
    })
  })

  describe('checked 字段', () => {
    it('应提取选中的 checkbox', () => {
      const input = createElement('input', { type: 'checkbox' }) as HTMLInputElement
      input.checked = true
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.checked).toBe(true)
    })

    it('未选中的 checkbox 不输出 checked', () => {
      const input = createElement('input', { type: 'checkbox' }) as HTMLInputElement
      input.checked = false
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.checked).toBeUndefined()
    })
  })

  describe('disabled 字段', () => {
    it('应提取禁用的按钮', () => {
      const button = createElement('button', {}, 'Submit') as HTMLButtonElement
      button.disabled = true
      document.body.appendChild(button)
      mockElement(button)
      button.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === 'Submit')

      expect(el?.disabled).toBe(true)
    })

    it('应提取 aria-disabled=true', () => {
      const button = createElement('button', { 'aria-disabled': 'true' }, 'Submit')
      document.body.appendChild(button)
      mockElement(button)
      button.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === 'Submit')

      expect(el?.disabled).toBe(true)
    })
  })

  describe('expanded 字段', () => {
    it('应提取展开的 details', () => {
      const details = document.createElement('details')
      details.open = true
      const summary = document.createElement('summary')
      summary.textContent = 'More'
      details.appendChild(summary)
      document.body.appendChild(details)
      mockElement(details)
      details.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'details')

      expect(el?.expanded).toBe(true)
    })

    it('应提取 aria-expanded=true', () => {
      const button = createElement('button', { 'aria-expanded': 'true' }, 'Menu')
      document.body.appendChild(button)
      mockElement(button)
      button.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.text === 'Menu')

      expect(el?.expanded).toBe(true)
    })
  })

  describe('required 字段', () => {
    it('应提取必填 input', () => {
      const input = createElement('input', { type: 'text', placeholder: 'Name' }) as HTMLInputElement
      input.required = true
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.required).toBe(true)
    })

    it('应提取 aria-required=true', () => {
      const input = createElement('input', { type: 'text', 'aria-required': 'true', placeholder: 'Name' })
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.required).toBe(true)
    })
  })

  describe('placeholder 字段', () => {
    it('应提取 input 的 placeholder', () => {
      const input = createElement('input', { type: 'text', placeholder: '请输入手机号' })
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.placeholder).toBe('请输入手机号')
    })
  })

  describe('label 字段', () => {
    it('应提取关联的 label 文本', () => {
      const label = createElement('label', { for: 'email' }, '邮箱')
      const input = createElement('input', { type: 'email', id: 'email' })
      document.body.appendChild(label)
      document.body.appendChild(input)
      mockElement(input)
      input.dataset.skeletonId = 'e1'

      const skeleton = extractSkeleton(document, 'viewport')
      const el = skeleton.elements.find(e => e.tag === 'input')

      expect(el?.label).toBe('邮箱')
    })
  })
})

describe('hasModalOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('应检测 role=dialog', () => {
    const dialog = createElement('div', { role: 'dialog' }, 'Modal')
    document.body.appendChild(dialog)
    mockElement(dialog)

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.hasModal).toBe(true)
  })

  it('应检测 aria-modal=true', () => {
    const modal = createElement('div', { 'aria-modal': 'true' }, 'Modal')
    document.body.appendChild(modal)
    mockElement(modal)

    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.hasModal).toBe(true)
  })

  it('无弹窗时返回 false', () => {
    const skeleton = extractSkeleton(document, 'viewport')

    expect(skeleton.hasModal).toBe(false)
  })
})

describe('extractFullSkeleton', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('应调用 extractSkeleton with full scope', () => {
    const button = createElement('button', {}, 'Full Page Button')
    document.body.appendChild(button)
    mockElement(button, { inViewport: false })
    button.dataset.skeletonId = 'e1'

    const skeleton = extractFullSkeleton(document)

    const fullPageBtn = skeleton.elements.find((el) => el.text === 'Full Page Button')
    expect(fullPageBtn).toBeDefined()
  })
})
