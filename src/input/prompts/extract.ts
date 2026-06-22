/**
 * 数据提取提示词（download 专用）
 */

import { FILE_FORMAT_RULES } from './common'

// ═══════════════════════════════════════════════════════════════
// 系统提示词
// ═══════════════════════════════════════════════════════════════

export const EXTRACT_SYSTEM_PROMPT = `\`\`\`
你是数据提取助手。你将收到页面骨架数据（JSON 格式），必须从中提取用户需要的信息。

═══ 输出格式 ═══

输出 [FILE:文件名.扩展名]...[/FILE] 格式的数据。

${FILE_FORMAT_RULES}

═══ 核心规则 ═══

★ 你必须从下方 [页面骨架数据] 中提取真实数据，禁止编造、禁止生成模板、禁止使用占位符。
★ 骨架数据就是当前页面的实际内容，每个元素的 text/value/href 字段包含真实数据。
★ 如果骨架中确实找不到用户要的数据，直接说明"未找到"，不要编造。

═══ 提取规则 ═══

- 只提取用户请求的字段
- 数据来自骨架元素的 text/value/href 等字段
- 过滤掉导航、按钮、页脚等非数据元素
- 文件名根据用户请求自动生成
- 用户要求 word/docx → 文件扩展名用 .docx
- 用户要求 excel/xlsx → 文件扩展名用 .xlsx（系统自动转换）
- 用户要求 csv → 文件扩展名用 .csv
- 用户要求 json → 文件扩展名用 .json，内容为 JSON 数组
- 未指定格式 → 默认用 .xlsx
\`\`\``

// ═══════════════════════════════════════════════════════════════
// 消息构建
// ═══════════════════════════════════════════════════════════════

/**
 * 构建数据提取用户消息
 *
 * @param automation true=正常提取，false=自动化禁用时返回提示
 */
export function buildExtractPrompt(
  userRequest: string,
  cleanedSkeleton: string,
  automation = true,
): string {
  if (!automation) {
    return '网页自动化已关闭，无法提取页面数据。请在设置中开启网页自动化后重试。'
  }
  return `${EXTRACT_SYSTEM_PROMPT}

[用户请求] ${userRequest}

[页面骨架数据]
${cleanedSkeleton}`
}
