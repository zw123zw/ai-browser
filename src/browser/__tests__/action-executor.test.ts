import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActionExecutor } from '../action-executor'
import type { Command } from '../types'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

vi.mock('../types', () => ({
  INTERACTIVE_TAGS: ['a', 'button', 'input', 'select', 'textarea', 'video', 'audio', 'label', 'summary', 'details'],
}))

describe('ActionExecutor', () => {
  let executor: ActionExecutor

  beforeEach(() => {
    executor = new ActionExecutor()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('click', () => {
    it('应通过 elementId 定位元素', async () => {
      const button = document.createElement('button')
      button.textContent = '提交'
      button.dataset.skeletonId = 'e10'
      button.click = vi.fn()
      document.body.appendChild(button)

      const cmd: Command = { action: 'click', elementId: 'e10', description: '提交', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })

    it('应通过 fallbackSelector 定位', async () => {
      const button = document.createElement('button')
      button.className = 'submit-btn'
      button.click = vi.fn()
      document.body.appendChild(button)

      const cmd: Command = { action: 'click', fallbackSelector: '.submit-btn', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })

    it('应通过文本匹配定位', async () => {
      const button = document.createElement('button')
      button.textContent = '登录'
      document.body.appendChild(button)

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        display: 'block',
        visibility: 'visible',
      } as CSSStyleDeclaration)

      const cmd: Command = { action: 'click', description: '登录', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })

    it('元素未找到时应返回失败', async () => {
      const cmd: Command = { action: 'click', elementId: 'nonexistent', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(false)
      expect(result.message).toContain('未找到')
    })

    it('label 点击应转发到关联表单元素', async () => {
      const label = document.createElement('label')
      label.setAttribute('for', 'email')
      const input = document.createElement('input')
      input.id = 'email'
      input.dataset.skeletonId = 'e1'
      input.focus = vi.fn()
      document.body.appendChild(label)
      document.body.appendChild(input)

      const cmd: Command = { action: 'click', elementId: 'e1', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })
  })

  describe('type', () => {
    it('应输入文本到 input', async () => {
      const input = document.createElement('input')
      input.type = 'text'
      input.dataset.skeletonId = 'e5'
      document.body.appendChild(input)

      const cmd: Command = { action: 'type', elementId: 'e5', text: 'hello', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(input.value).toBe('hello')
    })

    it('应使用 native value setter', async () => {
      const input = document.createElement('input')
      input.type = 'text'
      input.dataset.skeletonId = 'e1'
      document.body.appendChild(input)

      const setterSpy = vi.spyOn(HTMLInputElement.prototype, 'value', 'set')

      const cmd: Command = { action: 'type', elementId: 'e1', text: 'test', done: 1 }
      await executor.execute(cmd)

      expect(setterSpy).toHaveBeenCalled()
      setterSpy.mockRestore()
    })

    it('应自动聚焦目标元素', async () => {
      const input = document.createElement('input')
      input.dataset.skeletonId = 'e1'
      input.focus = vi.fn()
      document.body.appendChild(input)

      const cmd: Command = { action: 'type', elementId: 'e1', text: 'x', done: 1 }
      await executor.execute(cmd)

      expect(input.focus).toHaveBeenCalled()
    })
  })

  describe('clear', () => {
    it('应清空 input 值', async () => {
      const input = document.createElement('input')
      input.value = 'old value'
      input.dataset.skeletonId = 'e1'
      document.body.appendChild(input)

      const cmd: Command = { action: 'clear', elementId: 'e1', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(input.value).toBe('')
    })
  })

  describe('scroll', () => {
    it('应向下滚动', async () => {
      window.scrollBy = vi.fn()

      const cmd: Command = { action: 'scroll', direction: 'down', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })

    it('应向上滚动', async () => {
      window.scrollBy = vi.fn()

      const cmd: Command = { action: 'scroll', direction: 'up', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })
  })

  describe('navigate', () => {
    it('应通过 background 新标签页打开', async () => {
      ;(chrome.runtime.sendMessage as any).mockResolvedValue({ success: true, message: 'OK' })

      const cmd: Command = { action: 'navigate', url: 'https://example.com', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tab-action', action: 'newTab' }),
      )
    })

    it('未指定 URL 时应返回失败', async () => {
      const cmd: Command = { action: 'navigate', url: '', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(false)
    })
  })

  describe('keyboard', () => {
    it('应映射 key 名到 KeyboardEvent', async () => {
      document.dispatchEvent = vi.fn()

      const cmd: Command = { action: 'keyboard', key: 'Enter', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })
  })

  describe('select', () => {
    it('应选中下拉选项', async () => {
      const select = document.createElement('select')
      select.innerHTML = '<option value="a">A</option><option value="b">B</option>'
      select.dataset.skeletonId = 'e1'
      document.body.appendChild(select)

      const cmd: Command = { action: 'select', elementId: 'e1', text: 'b', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(select.value).toBe('b')
    })
  })

  describe('focus', () => {
    it('应聚焦元素', async () => {
      const input = document.createElement('input')
      input.dataset.skeletonId = 'e1'
      input.focus = vi.fn()
      document.body.appendChild(input)

      const cmd: Command = { action: 'focus', elementId: 'e1', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(input.focus).toHaveBeenCalled()
    })
  })

  describe('hover', () => {
    it('应触发悬停事件', async () => {
      const button = document.createElement('button')
      button.dataset.skeletonId = 'e1'
      document.body.appendChild(button)

      const dispatchSpy = vi.spyOn(button, 'dispatchEvent')

      const cmd: Command = { action: 'hover', elementId: 'e1', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(dispatchSpy).toHaveBeenCalled()
    })
  })

  describe('wait', () => {
    it('应延迟指定毫秒', async () => {
      vi.useFakeTimers()
      const cmd: Command = { action: 'wait', ms: 100, done: 1 }
      const promise = executor.execute(cmd)

      vi.advanceTimersByTime(100)
      const result = await promise

      expect(result.success).toBe(true)
      vi.useRealTimers()
    })
  })

  describe('video', () => {
    it('应播放视频', async () => {
      const video = document.createElement('video')
      video.play = vi.fn().mockResolvedValue(undefined)
      video.dataset.skeletonId = 'e1'
      document.body.appendChild(video)

      const cmd: Command = { action: 'video', elementId: 'e1', subAction: 'play', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })

    it('应暂停视频', async () => {
      const video = document.createElement('video')
      video.pause = vi.fn()
      video.dataset.skeletonId = 'e1'
      document.body.appendChild(video)

      const cmd: Command = { action: 'video', elementId: 'e1', subAction: 'pause', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })

    it('应设置音量', async () => {
      const video = document.createElement('video')
      video.dataset.skeletonId = 'e1'
      document.body.appendChild(video)

      const cmd: Command = { action: 'video', elementId: 'e1', subAction: 'volume', value: 0.5, done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(video.volume).toBe(0.5)
    })

    it('应静音', async () => {
      const video = document.createElement('video')
      video.dataset.skeletonId = 'e1'
      document.body.appendChild(video)

      const cmd: Command = { action: 'video', elementId: 'e1', subAction: 'mute', done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(video.muted).toBe(true)
    })

    it('应跳转时间', async () => {
      const video = document.createElement('video')
      video.currentTime = 10
      video.dataset.skeletonId = 'e1'
      document.body.appendChild(video)

      const cmd: Command = { action: 'video', elementId: 'e1', subAction: 'seek', value: 30, done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
    })

    it('应设置播放速率', async () => {
      const video = document.createElement('video')
      video.dataset.skeletonId = 'e1'
      document.body.appendChild(video)

      const cmd: Command = { action: 'video', elementId: 'e1', subAction: 'speed', value: 2, done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(true)
      expect(video.playbackRate).toBe(2)
    })
  })

  describe('未知 action', () => {
    it('应返回失败', async () => {
      const cmd: Command = { action: 'unknown' as any, done: 1 }
      const result = await executor.execute(cmd)

      expect(result.success).toBe(false)
    })
  })
})
