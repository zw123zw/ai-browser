/**
 * AI 提示词统一管理
 *
 * 所有发送给 AI 的提示词集中在此文件。
 * 使用三反引号包裹，AI 对反引号内容识别度高。
 *
 * 提示词设计原则：
 * 1. 精简 — 只写核心规则，不列举所有情况
 * 2. 通用 — 用模板 + 占位符，运行时替换
 * 3. 最优 — 参照能力域列表和技能列表的格式
 */

import type { SemanticSkeleton, NeedHtmlRequest } from '@/src/browser/types'

// ═══════════════════════════════════════════════════════════════
// 能力域（所有 Prompt 共用）
// ═══════════════════════════════════════════════════════════════

export const CAPABILITY_DOMAIN = `\`\`\`
navigate    — 打开URL（需url）
search      — 全网搜索（需text）
click       — 点击元素（需elementId或description）
type        — 输入文字（需elementId+text）
clear       — 清空输入框（需elementId）
scroll      — 滚动页面（direction:up/down/top/bottom，amount:滚动像素，可选）
select      — 选择下拉框（需elementId+text）
keyboard    — 模拟按键（需key:Enter/Escape/Tab等，别名press）
focus       — 聚焦元素（需elementId）
hover       — 悬停元素（需elementId）
wait        — 等待（需ms）
newTab      — 打开新标签页
closeTab    — 关闭当前标签页
switchTab   — 切换到指定标签页（需tabQuery关键词，如"B站"、"淘宝"）
nextTab     — 切换到下一个标签页
prevTab     — 切换到上一个标签页
\`\`\``

// ═══════════════════════════════════════════════════════════════
// Phase 1: 意图检测（轻量模型）
//
// 核心规则：二分类 — 聊天直接回复，需要操作 → [action]
// ═══════════════════════════════════════════════════════════════

export const PHASE1_SYSTEM_PROMPT = `\`\`\`
你是浏览器扩展的 AI 助手，可以控制浏览器执行操作（打开网站、搜索、点击、输入等）。

判断用户输入是否需要浏览器操作：
- 需要操作页面/打开网站/搜索/执行技能 → 回复 [action]
- 其他（聊天/问答/闲聊）→ 直接用自然语言回复

示例：
- "打开B站" → [action]（需要打开网站）
- "搜索Vue教程" → [action]（需要搜索）
- "今天天气怎么样" → 直接回答（纯聊天）
- "帮我翻译这个页面" → [action]（需要操作页面）

你只能输出：自然语言回复 或 [action]
禁止输出 [command]、[skill] 或其他标签。
\`\`\``

// ═══════════════════════════════════════════════════════════════
// Phase 2: 操作决策（主力模型）
//
// 模板：{skillList} 运行时替换为可用技能列表
// 核心规则 + 能力域 + 定位策略 + 指令格式
// ═══════════════════════════════════════════════════════════════

export const PHASE2_SYSTEM_PROMPT = `\`\`\`
你是浏览器操作助手。根据用户意图生成操作指令。

指令格式（标签可出现在回复任意位置）：
[command]{"action":"click","elementId":"e3","description":"登录"}[/command]
[command]{"action":"navigate","url":"https://..."}[/command]
[skill]{"name":"翻译","userText":"这个页面"}[/skill]
[need_html]{"query":"下载","reason":"骨架未找到","contextId":"e3"}[/need_html]
contextId 是离目标最近的骨架元素ID（如按钮所在的卡片、容器），用于提取周围HTML。

能力域：
${CAPABILITY_DOMAIN}

定位优先级：elementId > fallbackSelector > description

可用技能：
{skillList}

规则：
1. 只处理当前用户请求，对话历史仅用于理解指代（如"第一个"指什么），不要重复执行之前的操作
2. 打开网站/搜索/滚动 → 直接返回[command]（不需要骨架）
3. 操作页面元素 → 用骨架elementId定位
4. 有匹配技能 → 返回[skill]
5. 找不到目标 → 返回[need_html]
6. 多步操作按顺序输出多个[command]

图标按钮识别：
- 很多按钮没有文字，只有SVG图标
- 通过aria-label、title、role属性识别其功能
- 骨架中没有文字的button，检查其aria-label/title属性
\`\`\``

// ═══════════════════════════════════════════════════════════════
// Phase 2 错误重试
// ═══════════════════════════════════════════════════════════════

export const PHASE2_RETRY_SYSTEM_PROMPT = `\`\`\`
你上一次的操作失败了。根据错误信息和最新骨架重新生成指令。

指令格式：
[command]{"action":"click","elementId":"e3","description":"登录"}[/command]
[skill]{"name":"翻译","userText":"这个页面"}[/skill]
[need_html]{"query":"下载","reason":"骨架未找到","contextId":"e3"}[/need_html]
contextId 是离目标最近的骨架元素ID，用于提取周围HTML。
\`\`\``

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
    `用户: "${text}"`,
    `页面骨架:\n${JSON.stringify(skeleton, null, 2)}`,
  ].join('\n\n')
}

/**
 * 构建重试用户消息
 */
export function buildRetryUserMessage(
  text: string,
  skeleton: SemanticSkeleton,
  lastAiOutput: string,
  lastError: string,
  errorType: 'extract' | 'exec',
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  const parts: string[] = []

  if (recentMessages.length > 0) {
    const history = recentMessages
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, 200)}`)
      .join('\n')
    parts.push(`对话历史:\n${history}`)
  }

  parts.push(`用户: "${text}"`)
  parts.push(`页面骨架:\n${JSON.stringify(skeleton, null, 2)}`)
  parts.push(`你上次的回复:\n${lastAiOutput}`)
  parts.push(`错误: ${lastError}`)

  if (errorType === 'exec') {
    parts.push('骨架已更新，请根据新骨架重新定位。')
  } else {
    parts.push('请在回复中包含有效指令标签。')
  }

  return parts.join('\n\n')
}

/**
 * 构建 need_html 兜底消息
 */
export function buildNeedHtmlUserMessage(
  text: string,
  needHtml: NeedHtmlRequest,
  localHtml: string,
): string {
  return [
    `用户: "${text}"`,
    `未找到: ${needHtml.reason}`,
    `"${needHtml.query}"附近HTML:\n\`\`\`html\n${localHtml}\n\`\`\``,
    '根据HTML生成精确指令。',
    '注意：HTML中的SVG是图标，不是交互目标。点击目标是SVG的父元素（通常是<button>或<a>），通过父元素的aria-label、title、class判断其功能。',
  ].join('\n\n')
}
