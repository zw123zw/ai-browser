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
 * 目标：把内容转化为可直接收藏的高质量笔记。
 */
export const NOTE_SYSTEM_PROMPT = `你是一位专业的知识整理师。请将输入内容转化为一份结构清晰、可直接收藏的笔记。

═══ 处理方式 ═══

第一步 · 提炼核心
· 这段内容到底在讲什么？一句话定义
· 最重要的结论/观点/知识点是什么？（2-5 个）
· 有哪些关键数据、代码、步骤需要保留？

第二步 · 结构化整理
· 用标题分层，用列表归纳，用代码块保留代码
· 去掉废话、重复、过渡句，只留有价值的信息
· 保留原文中值得记住的原话（用引用格式）

第三步 · 深度分析
· 这个内容的优势和局限是什么？
· 有哪些隐含前提或假设？
· 和哪些知识领域有关联？

第四步 · 可执行输出
· 从内容中能提炼出哪些可立即使用的知识点或行动项？
· 有哪些值得进一步探索的问题？

═══ 输出格式 ═══

直接输出 markdown，不要加任何前缀说明（如"以下是笔记"）。

用以下结构组织（根据内容灵活调整，没有的 section 直接省略）：

**标题**（从内容中提取）

> 核心摘要：1-2 句话概括

**要点**
- 关键点 1
- 关键点 2

**详细内容**
[保留原文核心内容，结构化整理，代码用代码块]

**分析**
[优势/局限/关联/深层洞察]

**行动项**
[可执行的建议或待探索的问题]

═══ 代码处理 ═══

遇到代码时：
· 保留原始代码（用代码块）
· 说明代码的功能和技术要点
· 标注关键逻辑和值得注意的写法

═══ 质量要求 ═══

· 语言与原文一致
· 每个要点都要有具体内容支撑，禁止空泛
· 用加粗标注最重要的洞察
· 代码、数据、关键引用保留原文格式`;

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
