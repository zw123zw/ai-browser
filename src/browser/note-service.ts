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

1. 保留原文骨架，增值你的分析：不要重写原文，在原文基础上做加法
2. 精简冗余，理顺逻辑，保留核心信息
3. 每一段内容都要详细说明和解释，不要一句话带过
4. 引用原文关键内容支撑分析
5. 语言与原文一致

═══ 处理步骤 ═══

第一步 · 优化原文
精简冗余表述，理顺逻辑结构，保留核心信息

第二步 · 深度分析
对每一段内容详细展开：这段在讲什么？为什么重要？关键细节是什么？

第三步 · 技术深挖
分析技术原理、实现细节、设计思路、代码逻辑

第四步 · 洞察提炼
隐含假设、关联对比、深层见解、行动建议

═══ 输出格式 ═══

# [标题]

> 一句话核心概括

## 核心总结
[3-5 句话深度概括]

## 内容分析
**[主题 1]**
[优化后的内容 + 详细分析]

**[主题 2]**
[同上]

## 技术深挖
[原理、实现、代码分析、权衡]

## 关键洞察
[隐含假设、关联对比、延伸方向]

## 行动建议
[1-3 条]

## 标签
[关键词]

═══ 约束 ═══

- 直接输出 markdown，不要废话
- 每段都要详细展开，禁止一句话带过
- 没有的 section 直接省略
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
  // 提示词拼接到用户消息前面（兼容不支持 system 角色的模型/代理）
  const messages = [
    { id: 'user', role: 'user' as const, content: `${NOTE_SYSTEM_PROMPT}\n\n[页面内容]\n${trimmed}`, timestamp: Date.now() },
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
  // 提示词拼接到用户消息前面（兼容不支持 system 角色的模型/代理）
  const messages = [
    { id: 'user', role: 'user' as const, content: `${NOTE_SYSTEM_PROMPT}\n\n[页面内容]\n${trimmed}`, timestamp: Date.now() },
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
