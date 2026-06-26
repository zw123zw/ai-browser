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
export const NOTE_SYSTEM_PROMPT = `你是一位资深的内容分析师。请对输入内容进行深入、全面、详细的分析和总结，输出一份可直接收藏的高质量笔记。

═══ 分析流程 ═══

1. 通读全文，理解核心意图和整体结构
2. 逐层深入分析：核心观点 → 技术原理 → 实现细节 → 设计思路
3. 提炼关键洞察：优势、局限、隐含假设、关联知识
4. 整理为可直接收藏的高质量笔记

═══ 输出格式 ═══

直接输出 markdown，不要加任何前缀说明。

# [从内容中提取的标题]

> 一句话核心概括

## 核心总结
[3-5 句话深度概括：讲什么、解决什么问题、核心价值是什么]

## 详细分析
[对内容进行深入全面的分析：]
- 核心观点和论证逻辑
- 技术原理和实现机制
- 关键数据和事实依据

## 技术深挖
[如涉及技术内容，深入解释：]
- 原理是什么、为什么这样设计
- 关键实现细节和代码逻辑
- 优势、局限、适用场景

## 关键洞察
[提炼深层见解：]
- 隐含前提和假设
- 与其他技术/方案的关联对比
- 值得进一步探索的方向

## 行动建议
[可执行的建议]

## 标签
[\`关键词1\` \`关键词2\` \`关键词3\`]

═══ 质量标准 ═══

· 语言与原文一致
· 分析要深入、全面、有细节，不要空泛
· 引用原文关键内容支撑分析
· 代码要解释核心逻辑和设计意图
· 没有的 section 直接省略`;

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
