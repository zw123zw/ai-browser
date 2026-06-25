import { describe, it, expect } from 'vitest'
import { parseTranslateResponse, parseSingleTranslation } from '../translate-parser'

describe('parseTranslateResponse', () => {
  it('应直接解析 JSON 数组', () => {
    const raw = '[{"id":"e1","translated":"你好"},{"id":"e2","translated":"世界"}]'
    const results = parseTranslateResponse(raw)

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('e1')
    expect(results[0].translated).toBe('你好')
  })

  it('应从说明文字中提取 JSON 块', () => {
    const raw = '以下是翻译结果：\n[{"id":"e1","translated":"Hello"}]\n希望对你有帮助！'
    const results = parseTranslateResponse(raw)

    expect(results).toHaveLength(1)
    expect(results[0].translated).toBe('Hello')
  })

  it('应逐行提取对象（降级策略）', () => {
    const raw = '翻译完成：\n{"id":"e1","translated":"你好"}\n{"id":"e2","translated":"世界"}'
    const results = parseTranslateResponse(raw)

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('e1')
  })

  it('空字符串应返回空数组', () => {
    expect(parseTranslateResponse('')).toEqual([])
  })

  it('无有效数据时应返回空数组', () => {
    expect(parseTranslateResponse('没有翻译结果')).toEqual([])
  })

  it('应过滤无效条目', () => {
    const raw = '[{"id":"e1","translated":"你好"},{"bad":"entry"}]'
    const results = parseTranslateResponse(raw)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('e1')
  })

  it('应处理转义字符', () => {
    const raw = '[{"id":"e1","translated":"他说\\"你好\\""}]'
    const results = parseTranslateResponse(raw)

    expect(results).toHaveLength(1)
    expect(results[0].translated).toContain('"你好"')
  })
})

describe('parseSingleTranslation', () => {
  it('应从 JSON 对象中提取 translated', () => {
    const raw = '{"translated":"你好世界"}'
    const result = parseSingleTranslation(raw)

    expect(result).toBe('你好世界')
  })

  it('应去除常见前缀', () => {
    const raw = '翻译结果: Hello World'
    const result = parseSingleTranslation(raw)

    expect(result).toBe('Hello World')
  })

  it('应去除常见后缀', () => {
    const raw = 'Hello World 希望对你有帮助'
    const result = parseSingleTranslation(raw)

    expect(result).toBe('Hello World')
  })

  it('纯文本应原样返回', () => {
    const result = parseSingleTranslation('Hello World')
    expect(result).toBe('Hello World')
  })

  it('空字符串应返回空', () => {
    expect(parseSingleTranslation('')).toBe('')
  })
})
