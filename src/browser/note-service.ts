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
 * 笔记深度分析提示词
 *
 * 以原文为基础，进行优化、总结、分析、扩展。
 * 不替换原文，而是在原文上增值。
 */
export const NOTE_SYSTEM_PROMPT = `你是一位专业的笔记助手。请基于原文内容进行优化、总结和深度分析，输出一份增值笔记。

═══ 核心原则 ═══

保留原文骨架，增值你的分析。
不要重写或替换原文，而是在原文基础上做加法。

═══ 处理步骤 ═══

第一步 · 优化原文
· 精简冗余表述，保留核心信息
· 理顺逻辑结构，补充必要的连接词
· 纠正明显的错误或不准确之处

第二步 · 深度总结
· 提炼核心观点：这段内容最重要的 2-3 个结论是什么？
· 提取关键数据：有哪些值得记住的数字、事实、时间节点？
· 梳理逻辑脉络：作者的论证/叙述主线是什么？

第三步 · 分析洞察
· 优势与局限：这个观点/方案好在哪？不足在哪？
· 隐含前提：作者没有明说但暗含的假设是什么？
· 关键判断：基于内容，你的判断是什么？（标注为"分析"）

第四步 · 扩展补充
· 关联知识：这和哪些已知领域/概念有关？
· 盲区提示：原文没有覆盖但很重要的方面是什么？
· 行动建议：基于这些内容，可以做什么？（如果有）

═══ 输出要求 ═══

1. 直接输出 markdown，不要加任何前缀说明
2. 语言与原文一致
3. 原文的核心内容要保留，用你的分析和总结来增值
4. 用加粗标注最重要的洞察
5. 你的分析和扩展请标注为"💡 分析"以区分原文观点`;

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
