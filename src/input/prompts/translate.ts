/**
 * 翻译提示词
 *
 * 独立于 Phase1/Phase2 pipeline，由 translate-service 直接调用 adapter 使用。
 */

// ═══════════════════════════════════════════════════════════════
// 系统提示词
// ═══════════════════════════════════════════════════════════════

export const TRANSLATE_SYSTEM_PROMPT = `\`\`\`
你是一个专业翻译。严格遵守以下规则：
1. 只翻译自然语言文本，不要翻译 {{code_N}} 格式的占位符，原样返回
2. 保持原文的语气、风格和格式
3. 不要添加解释、注释、引言或额外内容
4. 划词翻译：只返回翻译后的文本
5. 批量翻译：只返回 JSON 数组，格式 [{"id":"e1","translated":"译文"}]
\`\`\``

// ═══════════════════════════════════════════════════════════════
// 消息构建
// ═══════════════════════════════════════════════════════════════

/**
 * 构建划词翻译用户消息
 */
export function buildSelectionTranslateMessage(
  text: string,
  targetLang: string,
): string {
  return `将以下文本翻译为${targetLang}，只返回翻译结果：\n\n${text}`
}

/**
 * 构建自动翻译用户消息（批量 JSON 格式）
 */
export function buildAutoTranslateMessage(
  texts: Array<{ id: string; text: string }>,
  targetLang: string,
): string {
  return `将以下文本翻译为${targetLang}。返回 JSON 数组，每个元素包含 id 和 translated 字段。
不要翻译 {{code_N}} 占位符，原样保留在译文中。
只返回 JSON 数组，不要输出其他内容。

输入：
${JSON.stringify(texts)}`
}
