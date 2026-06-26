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
 * 目标：对内容进行深入分析，输出可直接收藏的高质量笔记。
 */
export const NOTE_SYSTEM_PROMPT = `你是一位资深的知识分析师。请对输入内容进行深入分析，输出一份高质量的笔记。

═══ 分析方法 ═══

1. 通读内容，理解核心意图
2. 深入分析每个关键点的原理、细节、价值
3. 提炼出原文没有明说的深层洞察
4. 整理为结构清晰、可直接收藏的笔记

═══ 输出格式 ═══

直接输出 markdown，不要加任何前缀说明。

# [从内容中提取的标题]

> 核心总结：2-3 句话深度概括内容的核心和价值

## 关键要点
- **要点 1**：详细说明，不是一句话带过
- **要点 2**：详细说明
- **要点 3**...

## 深入分析
[对内容进行深度解读：]
- 技术原理是什么？为什么这样设计？
- 优势和局限分别是什么？
- 有哪些隐含前提或假设？
- 和其他技术/方案有什么关联或对比？

## 技术细节
[提取并深入解释关键技术点：]
- **[技术点 1]**：是什么 + 为什么 + 怎么用
- **[技术点 2]**：同上
- 代码要保留原始格式，解释实现逻辑和核心原理

## 行动建议
[1-3 条具体可执行的建议或待探索的问题]

## 标签
[\`关键词1\` \`关键词2\` \`关键词3\`]

═══ 代码处理 ═══

遇到代码时：
· 保留原始代码（用代码块，标注语言）
· 深入解释：解决什么问题、核心原理、关键 API 用法
· 标注值得注意的写法、潜在的坑、优化空间

═══ 质量标准 ═══

· 语言与原文一致
· 分析有深度，不要停留在表面概括
· 引用原文关键语句或代码支撑分析
· 每个要点都要有具体内容，禁止空泛
· 没有实质内容的 section 直接省略`;

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
