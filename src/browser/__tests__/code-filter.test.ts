import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isCodeElement, filterCodeText, restorePlaceholders } from '../code-filter'

describe('code-filter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('isCodeElement', () => {
    it('应过滤 pre 标签', () => {
      const pre = document.createElement('pre')
      expect(isCodeElement(pre)).toBe(true)
    })

    it('应过滤 code 标签（在 pre 内）', () => {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      pre.appendChild(code)
      expect(isCodeElement(code)).toBe(true)
    })

    it('应过滤独立 code 块', () => {
      const div = document.createElement('div')
      const code = document.createElement('code')
      div.appendChild(code)
      expect(isCodeElement(code)).toBe(true)
    })

    it('应过滤 samp 标签', () => {
      const samp = document.createElement('samp')
      expect(isCodeElement(samp)).toBe(true)
    })

    it('应过滤 hljs 类名元素', () => {
      const div = document.createElement('div')
      div.className = 'hljs javascript'
      expect(isCodeElement(div)).toBe(true)
    })

    it('应过滤 language-* 类名元素', () => {
      const div = document.createElement('div')
      div.className = 'language-python'
      expect(isCodeElement(div)).toBe(true)
    })

    it('应过滤 code-block 类名元素', () => {
      const div = document.createElement('div')
      div.className = 'code-block'
      expect(isCodeElement(div)).toBe(true)
    })

    it('应过滤 highlight 类名元素', () => {
      const div = document.createElement('div')
      div.className = 'highlight-source-js'
      expect(isCodeElement(div)).toBe(true)
    })

    it('不应过滤普通元素', () => {
      const p = document.createElement('p')
      p.textContent = '普通文本'
      expect(isCodeElement(p)).toBe(false)
    })

    it('不应过滤行内 code（父元素有文本兄弟节点）', () => {
      const p = document.createElement('p')
      p.textContent = '使用 '
      const code = document.createElement('code')
      code.textContent = 'console.log'
      p.appendChild(code)
      p.appendChild(document.createTextNode(' 输出'))
      expect(isCodeElement(code)).toBe(false)
    })
  })

  describe('filterCodeText', () => {
    it('应替换反引号代码为占位符', () => {
      const text = '使用 `console.log()` 输出'
      const result = filterCodeText(text)

      expect(result.text).toContain('{{code_')
      expect(result.text).not.toContain('console.log')
      expect(result.placeholders.size).toBeGreaterThan(0)
    })

    it('应替换 URL 为占位符', () => {
      const text = '访问 https://example.com 查看'
      const result = filterCodeText(text)

      expect(result.text).toContain('{{code_')
      expect(result.placeholders.size).toBeGreaterThan(0)
    })

    it('应替换 JSON 片段为占位符', () => {
      const text = '配置 {"name":"test","value":123} 完成'
      const result = filterCodeText(text)

      expect(result.text).toContain('{{code_')
    })

    it('应替换函数调用为占位符', () => {
      const text = '调用 getUser(id) 获取用户'
      const result = filterCodeText(text)

      expect(result.text).toContain('{{code_')
    })

    it('应跳过纯中文内容', () => {
      const text = '这是【中文括号】的内容'
      const result = filterCodeText(text)

      expect(result.text).toBe(text)
      expect(result.placeholders.size).toBe(0)
    })

    it('无代码文本应不修改', () => {
      const text = '这是一段普通中文文本，没有任何代码。'
      const result = filterCodeText(text)

      expect(result.text).toBe(text)
      expect(result.placeholders.size).toBe(0)
    })
  })

  describe('restorePlaceholders', () => {
    it('应恢复占位符为原始代码', () => {
      const placeholders = new Map<string, string>([
        ['{{code_01}}', '`console.log()`'],
      ])
      const filtered = '使用 {{code_01}} 输出'
      const restored = restorePlaceholders(filtered, placeholders)

      expect(restored).toBe('使用 `console.log()` 输出')
    })

    it('应恢复多个占位符', () => {
      const placeholders = new Map<string, string>([
        ['{{code_01}}', '`foo()`'],
        ['{{code_02}}', '`bar()`'],
      ])
      const filtered = '调用 {{code_01}} 和 {{code_02}} 函数'
      const restored = restorePlaceholders(filtered, placeholders)

      expect(restored).toBe('调用 `foo()` 和 `bar()` 函数')
    })

    it('无占位符时应返回原文', () => {
      const text = '普通文本'
      const placeholders = new Map<string, string>()
      const restored = restorePlaceholders(text, placeholders)

      expect(restored).toBe(text)
    })
  })
})
