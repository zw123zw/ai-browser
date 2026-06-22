/**
 * 页面分析总结提示词（summarize 专用）
 *
 * 提取页面全文后发送给 AI，AI 返回分析总结。
 * 与 download 的区别：summarize 输出聊天消息，download 输出文件。
 */

/** 分析总结系统提示词 */
export const SUMMARIZE_SYSTEM_PROMPT = `你是一个网页内容分析助手。根据页面全文内容，进行全面深入的分析总结。

═══ 分析要求 ═══

- 涵盖页面主题、核心内容、关键信息
- 结构清晰，分层分点
- 如果页面有数据/列表/表格，提取并归纳
- 如果页面有优缺点/对比/评价，分析并总结
- 给出你认为最有价值的洞察`

/**
 * 构建分析总结用户消息
 */
export function buildSummarizePrompt(
  userRequest: string,
  pageText: string,
): string {
  return `${SUMMARIZE_SYSTEM_PROMPT}

[用户请求] ${userRequest}

[页面全文内容]
${pageText}`
}
