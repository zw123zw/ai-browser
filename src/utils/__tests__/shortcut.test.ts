import { describe, it, expect } from 'vitest'
import { matchShortcut, eventToShortcut } from '../shortcut'

function createKeyboardEvent(init: {
  key: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent
}

describe('matchShortcut', () => {
  it('应匹配 Ctrl+Shift+B', () => {
    const e = createKeyboardEvent({ key: 'b', ctrlKey: true, shiftKey: true })
    expect(matchShortcut(e, 'Ctrl+Shift+B')).toBe(true)
  })

  it('应匹配 Ctrl+`', () => {
    const e = createKeyboardEvent({ key: '`', ctrlKey: true })
    expect(matchShortcut(e, 'Ctrl+`')).toBe(true)
  })

  it('不匹配时应返回 false', () => {
    const e = createKeyboardEvent({ key: 'a', ctrlKey: true })
    expect(matchShortcut(e, 'Ctrl+Shift+B')).toBe(false)
  })

  it('空 shortcut 应返回 false', () => {
    const e = createKeyboardEvent({ key: 'a' })
    expect(matchShortcut(e, '')).toBe(false)
  })

  it('应匹配 Alt+T', () => {
    const e = createKeyboardEvent({ key: 't', altKey: true })
    expect(matchShortcut(e, 'Alt+T')).toBe(true)
  })

  it('应匹配 Meta+K', () => {
    const e = createKeyboardEvent({ key: 'k', metaKey: true })
    expect(matchShortcut(e, 'Meta+K')).toBe(true)
  })

  it('大小写不敏感', () => {
    const e = createKeyboardEvent({ key: 'B', ctrlKey: true, shiftKey: true })
    expect(matchShortcut(e, 'ctrl+shift+b')).toBe(true)
  })
})

describe('eventToShortcut', () => {
  it('Ctrl+Shift+B → "Ctrl+Shift+B"', () => {
    const e = createKeyboardEvent({ key: 'b', ctrlKey: true, shiftKey: true })
    expect(eventToShortcut(e)).toBe('Ctrl+Shift+B')
  })

  it('单独修饰键应返回 null', () => {
    const e = createKeyboardEvent({ key: 'Control', ctrlKey: true })
    expect(eventToShortcut(e)).toBeNull()
  })

  it('无修饰键应返回 null', () => {
    const e = createKeyboardEvent({ key: 'a' })
    expect(eventToShortcut(e)).toBeNull()
  })

  it('空格键应转为 Space', () => {
    const e = createKeyboardEvent({ key: ' ', ctrlKey: true })
    expect(eventToShortcut(e)).toBe('Ctrl+Space')
  })

  it('单字母应大写', () => {
    const e = createKeyboardEvent({ key: 'b', ctrlKey: true })
    expect(eventToShortcut(e)).toBe('Ctrl+B')
  })
})
