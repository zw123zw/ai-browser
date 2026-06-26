/**
 * Phase 2: 操作决策提示词
 *
 * 模板：{coreRule} 运行时替换为模式描述（首次/流式/重试）
 */

import type { SemanticSkeleton } from '@/src/browser/types'
import {
  CAPABILITY_LIST,
  FILE_FORMAT_RULES,
  COMMAND_CLOSE_RULE,
} from './common'

// ═══════════════════════════════════════════════════════════════
// 完整版（自动化开启）
// ═══════════════════════════════════════════════════════════════

export const PHASE2_SYSTEM_PROMPT = `\`\`\`
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
{coreRule}
★ 必须输出一条指令标签，禁止返回空回复。

═══ 输出格式（严格三选一）═══

[command]{...} — 执行浏览器操作
[need_full]    — 骨架中找不到目标元素，请求全页骨架
[need_input]   — 需要用户输入私有信息（密码、验证码等），暂停等待

═══ 如何选择输出格式 ═══

· 从骨架中找到目标元素 → [command]
· 骨架中找不到目标（可能需要 hover 展开菜单等）→ [need_full]
· 需要用户私有信息（密码、验证码、手机号等）→ [need_input]
· 协议/Cookie 弹窗 → 先 click 同意按钮，不要 [need_input]

═══ [command] 模块 ═══

格式（必填 action + description + done，其余按需选填）：
[command]{"action":"操作","elementId":"e3","text":"内容","url":"地址","direction":"方向","key":"按键","tabQuery":"关键词","description":"描述","done":0或1}[/command]

done 判定：done:1 = 用户原始请求的最终目标已达成（不是当前步骤完成）
  · "打开百度" → 打开即 done:1
  · "帮我登录" → 打开网站 done:0，登录成功 done:1
  · 多步任务中只有最后一步才 done:1

支持的操作：
${CAPABILITY_LIST}

示例：
[command]{"action":"click","elementId":"e3","description":"登录","done":1}[/command]
[command]{"action":"type","elementId":"e5","text":"hello","description":"输入文字","done":0}[/command]

═══ 批量 [command] ═══

多个相同操作（批量点赞、批量填表等）：
[command][
  {"action":"click","elementId":"e10","description":"点赞第1条","done":0},
  {"action":"click","elementId":"e15","description":"点赞第2条","done":0},
  {"action":"click","elementId":"e20","description":"点赞第3条","done":1}
][/command]
- 数组最后一条 done=1，其余 done:0
- 某条失败不影响后续，单次不超过 20 条

═══ download 操作 ═══

提取当前页面数据，生成文件：
[command]{"action":"download","description":"提取商品名称和价格","done":1}[/command]

★ 每次 download 生成一个文件
★ done:1 = 生成文件后结束任务
★ done:0 = 生成文件后，系统自动点击"下一章/页"，继续请求 AI 执行下一步

批量导出流程：
- 用户说"导出所有章节" → 多次 download（done:0），最后一次 done:1
- 用户说"导出这个页面" → 一次 download（done:1）
- description 字段说明本次提取什么内容

═══ summarize 操作 ═══

分析总结当前页面内容：
[command]{"action":"summarize","description":"分析总结这个页面","done":1}[/command]
- ★ summarize 是一次性操作，必须 done:1，系统提取页面全文并 AI 分析，结果作为聊天消息返回
- 用户说"总结页面"、"分析这个页面"、"概括页面内容"等 → 输出 summarize

═══ [need_full] / [need_input] ═══

[need_full] — 单独输出，不需要闭合。系统返回全页骨架后直接用 elementId 生成 [command]

[need_input]{"message":"提示文字","type":"类型"}[/need_input]
type: credentials | verification_code | confirm | other
- 需要用户私有信息 → [need_input]，不要编造
- 无法自动处理的验证码 → [need_input]
- 协议弹窗 → 先 click 同意按钮，不需要 [need_input]

═══ 核心规则 ═══

· 打开网站/搜索/滚动 → 直接 [command]（不需要骨架）
· 骨架"(icon)"元素 → 检查 aria-label/title 判断功能
· 定位优先级：elementId > fallbackSelector > description
· ★ 悬停菜单：目标不在骨架中时，先 hover 父元素触发下拉菜单，再从新骨架 click 目标
· ★ 协议弹窗最高优先级：出现"同意"/"Accept"按钮时必须先 click，禁止跳过

═══ 禁止 ═══

${COMMAND_CLOSE_RULE}
- [need_input] 必须闭合
- 禁止编造用户私有信息
- 禁止输出除上述三种格式外的任何内容
\`\`\``

// ═══════════════════════════════════════════════════════════════
// 模式描述（注入 {coreRule} 占位符）
// ═══════════════════════════════════════════════════════════════

/** 首次进入 */
export const MODE_FIRST = '首次执行。根据用户请求和页面骨架，生成第1条指令。每次只生成1条，系统执行后反馈结果再生成下一条。'

/** 流式执行 */
export const MODE_STREAMING = '继续执行。根据用户原始请求、已完成步骤、当前页面骨架，生成下一条指令。'

/** 错误重试 */
export const MODE_RETRY = '上次指令执行失败。调整策略：元素被遮挡→先scroll让元素可见；元素不存在→输出[need_full]获取全页骨架；定位失败→换description匹配。根据以下失败信息生成新指令。'

// ═══════════════════════════════════════════════════════════════
// 动态构建
// ═══════════════════════════════════════════════════════════════

/**
 * 动态构建 Phase 2 系统提示词
 *
 * Phase 2 仅在自动化开启时被触发（Phase 1 输出 [action] 才会进入），
 * 因此始终返回完整版 prompt。保留 automation 参数供调用方兼容。
 */
export function buildPhase2Prompt(_automation?: boolean): string {
  return PHASE2_SYSTEM_PROMPT
}

// ═══════════════════════════════════════════════════════════════
// 消息构建函数
// ═══════════════════════════════════════════════════════════════

/**
 * 构建 Phase 2 用户消息
 *
 * 对话历史由 callAI 作为独立消息发送，此处不重复拼接。
 */
export function buildPhase2UserMessage(
  text: string,
  skeleton: SemanticSkeleton,
): string {
  return [
    `[当前请求] 用户: "${text}"`,
    `[页面骨架]\n${JSON.stringify(skeleton)}`,
  ].join('\n\n')
}

/**
 * 构建流式执行用户消息（每次 1 条指令）
 *
 * 消息结构：整块 skeleton JSON 替代散落拼接，
 * AI 一次性获得完整的页面上下文。
 */
export function buildStreamingUserMessage(
  text: string,
  skeleton: SemanticSkeleton,
  completed: Array<{ action: string; elementId?: string; description?: string }>,
  lastError?: string,
  lastFailedCommand?: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null,
  fullSkeleton?: string,
  userInputContext?: string,
): string {
  const parts: string[] = []

  parts.push(`[原始请求] 用户: "${text}"`)

  if (completed.length > 0) {
    const completedList = completed.map((c, i) =>
      `${i + 1}. ${c.action}${c.elementId ? ` ${c.elementId}` : ''}${c.description ? ` (${c.description})` : ''}`
    ).join('\n')
    parts.push(`[已完成] ${completedList}`)
  }

  if (lastError) {
    const errorParts = [`[上次错误] ${lastError}`]
    if (lastFailedCommand) {
      errorParts.push(`[失败指令] ${JSON.stringify(lastFailedCommand)}`)
    }
    parts.push(errorParts.join('\n'))
  }

  if (fullSkeleton) {
    parts.push(`[全页骨架]\n${fullSkeleton}`)
  } else {
    parts.push(`[页面骨架]\n${JSON.stringify(skeleton)}`)
  }

  if (userInputContext) {
    parts.push(`[用户补充信息] ${userInputContext}`)
  }

  return parts.join('\n\n')
}
