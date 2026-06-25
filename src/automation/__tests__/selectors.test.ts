import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SEARCH_INPUT_SELECTORS,
  SEARCH_RESULT_SELECTORS,
  NEXT_PAGE_SELECTORS,
  PREV_PAGE_SELECTORS,
  findElement,
  findElements,
} from '../selectors'

describe('selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('findElement', () => {
    it('应返回第一个匹配的元素', () => {
      const input = document.createElement('input')
      input.setAttribute('type', 'search')
      document.body.appendChild(input)

      const result = findElement(SEARCH_INPUT_SELECTORS)
      expect(result).toBe(input)
    })

    it('应按选择器优先级查找', () => {
      const input1 = document.createElement('input')
      input1.setAttribute('name', 'q')
      const input2 = document.createElement('input')
      input2.setAttribute('type', 'search')
      document.body.appendChild(input1)
      document.body.appendChild(input2)

      const result = findElement(['input[type="search"]', 'input[name="q"]'])
      expect(result).toBe(input2)
    })

    it('无结果时应返回 null', () => {
      const result = findElement(['.nonexistent'])
      expect(result).toBeNull()
    })

    it('应跳过无效选择器', () => {
      const input = document.createElement('input')
      input.setAttribute('type', 'search')
      document.body.appendChild(input)

      const result = findElement([':::invalid', 'input[type="search"]'])
      expect(result).toBe(input)
    })
  })

  describe('findElements', () => {
    it('应返回所有匹配的元素', () => {
      const a1 = document.createElement('a')
      const a2 = document.createElement('a')
      const div = document.createElement('div')
      div.appendChild(a1)
      div.appendChild(a2)
      document.body.appendChild(div)

      const results = findElements(['a'])
      expect(results).toHaveLength(2)
    })

    it('无匹配时应返回空数组', () => {
      const results = findElements(['.nonexistent'])
      expect(results).toEqual([])
    })
  })

  describe('选择器常量', () => {
    it('SEARCH_INPUT_SELECTORS 应包含百度搜索框', () => {
      expect(SEARCH_INPUT_SELECTORS).toContain('input[name="wd"]')
      expect(SEARCH_INPUT_SELECTORS).toContain('input[id="kw"]')
    })

    it('SEARCH_INPUT_SELECTORS 应包含 Google 搜索框', () => {
      expect(SEARCH_INPUT_SELECTORS).toContain('input[name="q"]')
    })

    it('SEARCH_RESULT_SELECTORS 应包含百度结果', () => {
      expect(SEARCH_RESULT_SELECTORS).toContain('.result h3 a')
    })

    it('NEXT_PAGE_SELECTORS 应包含百度下一页', () => {
      expect(NEXT_PAGE_SELECTORS).toContain('a.n')
    })

    it('PREV_PAGE_SELECTORS 应包含通用上一页', () => {
      expect(PREV_PAGE_SELECTORS).toContain('.prev')
    })
  })
})
