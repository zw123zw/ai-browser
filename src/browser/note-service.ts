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
 * 对内容进行优化、深度分析、详细解释、总结，输出可直接收藏的笔记。
 */
export const NOTE_SYSTEM_PROMPT = `你是一位资深的知识分析师。请对输入内容进行深度分析、详细解释和总结，输出一份可直接收藏的高质量笔记。

═══ 分析要求 ═══

1. **优化内容**：精简冗余，保留核心，理顺逻辑
2. **深度分析**：分析原理、机制、设计思路，不停留在表面描述
3. **详细解释**：每个关键点都要展开说明是什么、为什么、怎么用
4. **总结提炼**：提炼核心观点、关键洞察、可执行建议

═══ 输出格式 ═══

直接输出 markdown，不要加任何前缀说明。

# [从内容中提取的标题]

> 核心总结：2-3 句话深度概括内容的核心价值

## 关键要点
- **要点 1**：详细展开说明，包含具体细节
- **要点 2**：详细展开说明
- **要点 3**...

## 深入分析
[对内容进行深度解读，包括：]
- 技术原理和实现机制
- 设计思路和权衡取舍
- 优势、局限、隐含前提
- 与其他方案的对比关联

## 技术细节
[提取关键技术点，逐一详细解释：]
- **[技术点]**：是什么 → 为什么 → 怎么用 → 注意事项
- 代码保留原始格式，解释核心逻辑和实现原理

## 代码分析
[如有代码，深入解释：]
- 解决什么问题
- 核心实现原理
- 关键 API/函数用法
- 值得注意的写法和潜在坑点

## 总结
[整体评价 + 行动建议 + 待探索问题]

## 标签
[\`关键词1\` \`关键词2\` \`关键词3\`]

═══ 质量标准 ═══

· 语言与原文一致
· 分析有深度有细节，不要空泛概括
· 引用原文关键语句或代码支撑分析
· 每个技术点都要解释"是什么+为什么+怎么用"
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
