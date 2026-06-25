import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToast } from '../useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 清空现有 toasts
    const { toasts, dismiss } = useToast()
    for (const t of [...toasts]) dismiss(t.id)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('info() 应添加 info 类型通知', () => {
    const { info, toasts } = useToast()
    info('测试消息')

    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('info')
    expect(toasts[0].message).toBe('测试消息')
  })

  it('success() 应添加 success 类型通知', () => {
    const { success, toasts } = useToast()
    success('成功')

    expect(toasts[0].type).toBe('success')
  })

  it('warning() 应添加 warning 类型通知', () => {
    const { warning, toasts } = useToast()
    warning('警告')

    expect(toasts[0].type).toBe('warning')
  })

  it('error() 应添加 error 类型通知', () => {
    const { error, toasts } = useToast()
    error('错误')

    expect(toasts[0].type).toBe('error')
  })

  it('应自动消失（默认 3000ms）', () => {
    const { info, toasts } = useToast()
    info('自动消失')

    expect(toasts).toHaveLength(1)

    vi.advanceTimersByTime(3000)

    expect(toasts).toHaveLength(0)
  })

  it('自定义 duration 应生效', () => {
    const { info, toasts } = useToast()
    info('自定义', 5000)

    vi.advanceTimersByTime(3000)
    expect(toasts).toHaveLength(1)

    vi.advanceTimersByTime(2000)
    expect(toasts).toHaveLength(0)
  })

  it('dismiss() 应手动关闭通知', () => {
    const { info, toasts, dismiss } = useToast()
    const id = info('手动关闭')

    expect(toasts).toHaveLength(1)
    dismiss(id)
    expect(toasts).toHaveLength(0)
  })

  it('应返回唯一 id', () => {
    const { info } = useToast()
    const id1 = info('消息1')
    const id2 = info('消息2')

    expect(id1).not.toBe(id2)
  })
})
