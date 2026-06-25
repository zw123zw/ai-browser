import { describe, it, expect, vi, beforeEach } from 'vitest'
import { plain } from '../storage-sync'

describe('plain', () => {
  it('应剥离 Vue 代理', () => {
    const obj = { a: 1, b: { c: 2 } }
    const result = plain(obj)

    expect(result).toEqual({ a: 1, b: { c: 2 } })
    expect(result).not.toBe(obj) // 应返回新对象
  })

  it('应处理数组', () => {
    const arr = [1, 2, 3]
    const result = plain(arr)

    expect(result).toEqual([1, 2, 3])
  })

  it('应处理嵌套对象', () => {
    const nested = { a: { b: { c: { d: 1 } } } }
    const result = plain(nested)

    expect(result).toEqual(nested)
    expect(result.a.b.c.d).toBe(1)
  })

  it('应处理 null', () => {
    expect(plain(null)).toBeNull()
  })

  it('应处理基本类型', () => {
    expect(plain(42)).toBe(42)
    expect(plain('hello')).toBe('hello')
    expect(plain(true)).toBe(true)
  })
})
