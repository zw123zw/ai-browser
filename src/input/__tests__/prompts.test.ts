import { describe, it, expect } from 'vitest'
import {
  CAPABILITY_DOMAIN_LIST,
  PHASE1_SYSTEM_PROMPT,
  PHASE2_SYSTEM_PROMPT,
  MODE_FIRST,
  MODE_STREAMING,
  MODE_RETRY,
  buildPhase2UserMessage,
  buildStreamingUserMessage,
} from '../prompts'

describe('CAPABILITY_DOMAIN_LIST', () => {
  it('应包含 16+ 项能力', () => {
    expect(CAPABILITY_DOMAIN_LIST.length).toBeGreaterThanOrEqual(16)
  })

  it('每项应有 id、desc、needSkeleton', () => {
    for (const item of CAPABILITY_DOMAIN_LIST) {
      expect(item.id).toBeTruthy()
      expect(item.desc).toBeTruthy()
      expect(typeof item.needSkeleton).toBe('boolean')
    }
  })

  it('navigate 的 needSkeleton 应为 false', () => {
    const navigate = CAPABILITY_DOMAIN_LIST.find(item => item.id === 'navigate')
    expect(navigate?.needSkeleton).toBe(false)
  })

  it('click 的 needSkeleton 应为 true', () => {
    const click = CAPABILITY_DOMAIN_LIST.find(item => item.id === 'click')
    expect(click?.needSkeleton).toBe(true)
  })

  it('应包含关键能力项', () => {
    const ids = CAPABILITY_DOMAIN_LIST.map(item => item.id)
    expect(ids).toContain('navigate')
    expect(ids).toContain('click')
    expect(ids).toContain('type')
    expect(ids).toContain('scroll')
    expect(ids).toContain('search')
  })
})

describe('PHASE1_SYSTEM_PROMPT', () => {
  it('应包含 [command] 输出格式', () => {
    expect(PHASE1_SYSTEM_PROMPT).toContain('[command]')
  })

  it('应包含 [action] 输出格式', () => {
    expect(PHASE1_SYSTEM_PROMPT).toContain('[action]')
  })

  it('应包含 [FILE:] 文件格式', () => {
    expect(PHASE1_SYSTEM_PROMPT).toContain('[FILE:')
  })

  it('应包含网站映射规则', () => {
    expect(PHASE1_SYSTEM_PROMPT).toContain('B站')
    expect(PHASE1_SYSTEM_PROMPT).toContain('bilibili.com')
  })
})

describe('PHASE2_SYSTEM_PROMPT', () => {
  it('应包含 [command] 输出格式', () => {
    expect(PHASE2_SYSTEM_PROMPT).toContain('[command]')
  })

  it('应包含 [need_full] 输出格式', () => {
    expect(PHASE2_SYSTEM_PROMPT).toContain('[need_full]')
  })

  it('应包含 [need_input] 输出格式', () => {
    expect(PHASE2_SYSTEM_PROMPT).toContain('[need_input]')
  })

  it('应包含 {coreRule} 占位符', () => {
    expect(PHASE2_SYSTEM_PROMPT).toContain('{coreRule}')
  })

  it('应包含 done 字段说明', () => {
    expect(PHASE2_SYSTEM_PROMPT).toContain('done')
    expect(PHASE2_SYSTEM_PROMPT).toContain('最终目标已达成')
  })
})

describe('MODE 常量', () => {
  it('MODE_FIRST 应包含首次执行', () => {
    expect(MODE_FIRST).toContain('首次执行')
  })

  it('MODE_STREAMING 应包含继续执行', () => {
    expect(MODE_STREAMING).toContain('继续执行')
  })

  it('MODE_RETRY 应包含重试', () => {
    expect(MODE_RETRY).toContain('上次指令执行失败')
    expect(MODE_RETRY).toContain('[need_full]')
  })
})

describe('buildPhase2UserMessage', () => {
  it('应包含原始请求和页面骨架', () => {
    const text = '点击登录按钮'
    const skeleton = {
      url: 'https://example.com',
      title: 'Example',
      elements: [{ id: 'e1', tag: 'button', text: '登录' }],
    }

    const result = buildPhase2UserMessage(text, skeleton as any)

    expect(result).toContain('[当前请求]')
    expect(result).toContain('点击登录按钮')
    expect(result).toContain('页面骨架')
    expect(result).toContain('"id":"e1"')
  })
})

describe('buildStreamingUserMessage', () => {
  it('应包含已完成步骤', () => {
    const text = '点击登录按钮'
    const skeleton = {
      url: 'https://example.com',
      title: 'Example',
      elements: [{ id: 'e1', tag: 'button', text: '登录' }],
    }
    const completed = [{ action: 'click', elementId: 'e1', description: '点击登录' }]

    const result = buildStreamingUserMessage(text, skeleton as any, completed)

    expect(result).toContain('[原始请求]')
    expect(result).toContain('[已完成]')
    expect(result).toContain('click e1 (点击登录)')
  })

  it('应包含错误信息', () => {
    const text = '点击登录按钮'
    const skeleton = { url: 'https://example.com', title: 'Example', elements: [] }
    const completed: any[] = []
    const lastError = '元素不可见'
    const lastFailedCommand = { action: 'click', elementId: 'e1' }

    const result = buildStreamingUserMessage(
      text, skeleton as any, completed, lastError, lastFailedCommand,
    )

    expect(result).toContain('[上次错误]')
    expect(result).toContain('元素不可见')
    expect(result).toContain('[失败指令]')
  })
})
