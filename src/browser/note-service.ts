/**
 * 笔记 AI 服务
 *
 * 对文本进行深度分析、提炼、扩展，输出高密度 markdown 笔记。
 * 划词笔记、点击笔记、自动笔记共用同一套提示词。
 */

import { createAdapter } from '@/src/adapters';
import type { AppSettings, StreamChunk } from '@/src/types';
import { Logger } from '@/src/utils/logger';

const log = new Logger('NoteService');

/**
 * 笔记提示词（划词/点击/自动笔记共用）
 *
 * 对内容进行深入、全面、详细的分析和总结，输出可直接收藏的笔记。
 */
export const NOTE_SYSTEM_PROMPT = `你是一位资深的内容分析师。直接输出笔记，不要废话，不要加任何前缀说明。

═══ 规则 ═══

1. 对原文内容进行文字优化：精简冗余，理顺逻辑，保留核心
2. 每一段内容都要详细说明和解释，不要一句话带过
3. 引用原文关键内容支撑分析
4. 语言与原文一致

═══ 输出格式 ═══

# [从内容中提取的标题]

> 一句话核心概括

## 核心总结

[3-5 句话深度概括：这篇文章讲什么？解决什么问题？核心观点和价值是什么？]

## 内容分析

[对原文每一段内容进行详细分析，优化文字并深入解释：]

**[段落/主题 1 标题]**
[优化后的核心内容 + 详细说明：这段在讲什么？为什么重要？有什么关键细节？]

**[段落/主题 2 标题]**
[同上，逐段详细展开]

**[段落/主题 N...]**
[每段都要分析到，不要跳过]

## 技术深挖

[如涉及技术内容，深入解释：]
- **原理**：底层机制是什么？为什么这样设计？
- **实现**：关键代码逻辑、API 用法、算法步骤
- **代码分析**：保留关键代码，解释核心逻辑和设计意图
- **权衡**：优势和局限？适用场景？

## 关键洞察

- [深层见解：隐含前提、假设、盲区]
- [关联对比：与其他技术/方案的关系]
- [延伸方向：值得进一步探索的问题]

## 行动建议

[1-3 条具体可执行的建议]

## 标签

[\`关键词1\` \`关键词2\` \`关键词3\`]

═══ 约束 ═══

- 直接输出 markdown，不要加"以下是笔记"等废话
- 每段内容都要详细展开，禁止"要点1：xxx"一句话带过
- 没有的 section 直接省略，不要写"无"或"N/A"
- 代码保留原始格式，解释核心逻辑`;

/**
 * 调用 AI 深度分析文本为笔记
 *
 * @param text - 原始文本
 * @param settings - 全局设置
 * @param modelId - 可选模型 id
 * @returns AI 分析后的 markdown 笔记
 */
export async function optimizeAsNote(
  text: string,
  settings: AppSettings,
  modelId?: string,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('文本内容为空');
  }

  const models = settings.models || [];
  const model = modelId
    ? models.find((m) => m.id === modelId) || models[0]
    : models.find((m) => m.id === settings.defaultModelId) || models[0];

  if (!model) {
    throw new Error('没有可用的模型');
  }

  const adapter = createAdapter(model.provider);
  const messages = [
    { id: 'sys', role: 'system' as const, content: NOTE_SYSTEM_PROMPT, timestamp: Date.now() },
    { id: 'user', role: 'user' as const, content: trimmed, timestamp: Date.now() },
  ];

  log.info('调用 AI 分析笔记', { model: model.modelName, textLength: trimmed.length });

  let result = '';
  await adapter.chat(
    {
      baseUrl: model.baseUrl || settings.baseUrl || '',
      apiKey: model.apiKey || settings.apiKey || '',
      modelName: model.modelName,
      provider: model.provider,
      messages,
    },
    (chunk: StreamChunk) => {
      if (chunk.delta) result += chunk.delta;
    },
  );

  log.info('笔记分析完成', { length: result.length, preview: result.slice(0, 80) });
  return result;
}

/**
 * 流式调用 AI 分析笔记（每个 chunk 回调）
 *
 * @param text - 原始文本
 * @param settings - 全局设置
 * @param onChunk - 每个增量回调
 * @param modelId - 可选模型 id
 * @returns 完整的笔记内容
 */
export async function optimizeAsNoteStream(
  text: string,
  settings: AppSettings,
  onChunk: (delta: string, full: string) => void,
  modelId?: string,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('文本内容为空');
  }

  const models = settings.models || [];
  const model = modelId
    ? models.find((m) => m.id === modelId) || models[0]
    : models.find((m) => m.id === settings.defaultModelId) || models[0];

  if (!model) {
    throw new Error('没有可用的模型');
  }

  const adapter = createAdapter(model.provider);
  const messages = [
    { id: 'sys', role: 'system' as const, content: NOTE_SYSTEM_PROMPT, timestamp: Date.now() },
    { id: 'user', role: 'user' as const, content: trimmed, timestamp: Date.now() },
  ];

  log.info('流式调用 AI 分析笔记', { model: model.modelName, textLength: trimmed.length });

  let result = '';
  await adapter.chat(
    {
      baseUrl: model.baseUrl || settings.baseUrl || '',
      apiKey: model.apiKey || settings.apiKey || '',
      modelName: model.modelName,
      provider: model.provider,
      messages,
    },
    (chunk: StreamChunk) => {
      if (chunk.delta) {
        result += chunk.delta;
        onChunk(chunk.delta, result);
      }
    },
  );

  log.info('笔记流式分析完成', { length: result.length, preview: result.slice(0, 80) });
  return result;
}
