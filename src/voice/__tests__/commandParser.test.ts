import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseBatchCommand } from '../commandParser'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('parseBatchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('单条指令解析', () => {
    it('应解析 open_site 指令', () => {
      const text = '【code】open_site:https://www.baidu.com【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('open_site')
      expect(result.commandList[0].params).toBe('https://www.baidu.com')
    })

    it('应解析 search 指令', () => {
      const text = '【code】search:天气预报【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('search')
      expect(result.commandList[0].params).toBe('天气预报')
    })

    it('应解析 site_search 指令', () => {
      const text = '【code】site_search:Python教程【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('site_search')
    })

    it('应解析 open_item 指令', () => {
      const text = '【code】open_item:3【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('open_item')
      expect(result.commandList[0].params).toBe('3')
    })

    it('应解析无参指令 page_next', () => {
      const text = '【code】page_next【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('page_next')
    })

    it('应解析无参指令 page_prev', () => {
      const text = '【code】page_prev【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('page_prev')
    })

    it('应解析无参指令 video_play', () => {
      const text = '【code】video_play【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('video_play')
    })

    it('应解析无参指令 video_pause', () => {
      const text = '【code】video_pause【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('video_pause')
    })
  })

  describe('批量指令解析', () => {
    it('应解析多条指令', () => {
      const text = '好的，我来帮你操作。\n\n【code】open_site:https://www.baidu.com【/code】\n\n【code】search:天气【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(2)
      expect(result.commandList[0].type).toBe('open_site')
      expect(result.commandList[1].type).toBe('search')
    })

    it('应保留指令顺序', () => {
      const text = '【code】search:天气【/code】然后【code】open_item:1【/code】'
      const result = parseBatchCommand(text)

      expect(result.commandList[0].type).toBe('search')
      expect(result.commandList[1].type).toBe('open_item')
    })
  })

  describe('纯对话文本', () => {
    it('无指令标记时应返回 plainText', () => {
      const text = '你好，有什么可以帮助你的吗？'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(0)
      expect(result.plainText).toBe('你好，有什么可以帮助你的吗？')
    })

    it('空字符串应返回空 plainText', () => {
      const result = parseBatchCommand('')
      expect(result.total).toBe(0)
    })
  })

  describe('指令验证', () => {
    it('非法指令类型应报错', () => {
      const text = '【code】invalid_type:param【/code】'
      const result = parseBatchCommand(text)

      expect(result.hasError).toBe(true)
      expect(result.errorMsg).toContain('非法指令类型')
    })

    it('缺少必填参数应报错', () => {
      const text = '【code】open_site【/code】'
      const result = parseBatchCommand(text)

      expect(result.hasError).toBe(true)
      expect(result.errorMsg).toContain('缺少必填参数')
    })

    it('search 缺少参数应报错', () => {
      const text = '【code】search【/code】'
      const result = parseBatchCommand(text)

      expect(result.hasError).toBe(true)
    })
  })

  describe('混合指令和对话', () => {
    it('应分离指令和对话文本', () => {
      const text = '好的，我来帮你搜索。\n\n【code】search:天气【/code】'
      const result = parseBatchCommand(text)

      expect(result.total).toBe(1)
      expect(result.commandList[0].type).toBe('search')
    })
  })
})
