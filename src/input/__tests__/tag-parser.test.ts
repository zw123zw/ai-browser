import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractTags, isChatOnlyReply, getChatText } from '../tag-parser'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('extractTags', () => {
  it('应提取单条 [command]', () => {
    const text = '[command]{"action":"click","elementId":"e3","description":"登录"}[/command]'
    const result = extractTags(text)

    expect(result.commands).toHaveLength(1)
    expect(result.commands![0].action).toBe('click')
    expect(result.commands![0].elementId).toBe('e3')
    expect(result.commands![0].description).toBe('登录')
  })

  it('应提取多条 [command]', () => {
    const text = '[command]{"action":"click","elementId":"e1"}[/command][command]{"action":"type","elementId":"e2","text":"hello"}[/command]'
    const result = extractTags(text)

    expect(result.commands).toHaveLength(2)
    expect(result.commands![0].action).toBe('click')
    expect(result.commands![1].action).toBe('type')
  })

  it('应从自然语言中提取 [command]', () => {
    const text = '好的，我来帮你点击登录按钮。\n\n[command]{"action":"click","elementId":"e3"}[/command]'
    const result = extractTags(text)

    expect(result.commands).toHaveLength(1)
    expect(result.commands![0].action).toBe('click')
  })

  it('应检测 [action] 标签', () => {
    const text = '需要操作页面 [action]'
    const result = extractTags(text)

    expect(result.isAction).toBe(true)
    expect(result.hasAnyTag).toBe(true)
  })

  it('无 [action] 标签时 isAction 应为 false', () => {
    const text = '这是一条普通消息'
    const result = extractTags(text)

    expect(result.isAction).toBe(false)
  })

  it('应检测 [need_full] 标签', () => {
    const text = '[need_full]'
    const result = extractTags(text)

    expect(result.needFull).toBe(true)
    expect(result.hasAnyTag).toBe(true)
  })

  it('无 [need_full] 标签时 needFull 应为 falsy', () => {
    const text = '普通消息'
    const result = extractTags(text)

    expect(result.needFull).toBeFalsy()
  })

  it('应提取 [need_input] 标签', () => {
    const text = '[need_input]{"message":"请输入验证码","type":"verification_code"}[/need_input]'
    const result = extractTags(text)

    expect(result.needInput).toBeDefined()
    expect(result.needInput!.message).toBe('请输入验证码')
    expect(result.needInput!.type).toBe('verification_code')
  })

  it('应检测 [FILE:xxx] 标签', () => {
    const text = '[FILE:report.md]# 报告\n内容[/FILE]'
    const result = extractTags(text)

    expect(result.hasFileTags).toBe(true)
    expect(result.fileTagDetails!.filename).toBe('report.md')
    expect(result.hasAnyTag).toBe(true)
  })

  it('应提取 [chat] 标签', () => {
    const text = '[chat]你好，有什么可以帮助你的吗？[/chat]'
    const result = extractTags(text)

    expect(result.chatText).toBe('你好，有什么可以帮助你的吗？')
    expect(result.hasAnyTag).toBe(true)
  })

  it('JSON 解析失败时应使用回退解析', () => {
    const text = '[command]{"action":"click","text":"他说"你好""}[/command]'
    const result = extractTags(text)

    expect(result.commands).toHaveLength(1)
    expect(result.commands![0].action).toBe('click')
  })
})

describe('isChatOnlyReply', () => {
  it('有 [chat] 标签 → 纯聊天', () => {
    const text = '[chat]你好[/chat]'
    const tags = extractTags(text)
    expect(isChatOnlyReply(tags)).toBe(true)
  })

  it('无标签的自然语言 → 纯聊天', () => {
    const text = '你好，有什么可以帮助你的吗？'
    const tags = extractTags(text)
    expect(isChatOnlyReply(tags)).toBe(true)
  })

  it('有 [action] 标签 → 不是纯聊天', () => {
    const text = '需要操作 [action]'
    const tags = extractTags(text)
    expect(isChatOnlyReply(tags)).toBe(false)
  })

  it('有 [command] 标签 → 不是纯聊天', () => {
    const text = '[command]{"action":"click"}[/command]'
    const tags = extractTags(text)
    expect(isChatOnlyReply(tags)).toBe(false)
  })

  it('有 [need_input] → 不是纯聊天', () => {
    const text = '[need_input]{"message":"请输入"}[/need_input]'
    const tags = extractTags(text)
    expect(isChatOnlyReply(tags)).toBe(false)
  })

  it('有 [FILE] → 不是纯聊天', () => {
    const text = '[FILE:a.txt]内容[/FILE]'
    const tags = extractTags(text)
    expect(isChatOnlyReply(tags)).toBe(false)
  })
})

describe('getChatText', () => {
  it('有 [chat] 标签 → 返回标签内容', () => {
    const text = '[chat]你好[/chat]'
    const tags = extractTags(text)
    expect(getChatText(tags)).toBe('你好')
  })

  it('无标签 → 返回原始文本', () => {
    const text = '你好，有什么可以帮助你的吗？'
    const tags = extractTags(text)
    expect(getChatText(tags)).toBe('你好，有什么可以帮助你的吗？')
  })
})
