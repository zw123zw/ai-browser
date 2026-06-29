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
export const NOTE_SYSTEM_PROMPT = `请对以下内容进行优化整理，生成一份高质量的笔记。

优化方向：
- 精简冗余，保留核心信息
- 理顺逻辑，优化表达
- 每段内容详细展开说明和解释
- 保留关键内容、代码、数据

直接输出 markdown。`;

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
 * @param signal - 可选 AbortSignal，用于取消请求
 * @returns 完整的笔记内容
 */
export async function optimizeAsNoteStream(
  text: string,
  settings: AppSettings,
  onChunk: (delta: string, full: string) => void,
  modelId?: string,
  signal?: AbortSignal,
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

  log.info('流式调用 AI 分析笔记', { model: model.modelName, textLength: trimmed.length, hasSignal: !!signal });

  let result = '';
  try {
    await adapter.chat(
      {
        baseUrl: model.baseUrl || settings.baseUrl || '',
        apiKey: model.apiKey || settings.apiKey || '',
        modelName: model.modelName,
        provider: model.provider,
        messages,
        signal,
      },
      (chunk: StreamChunk) => {
        if (chunk.delta) {
          result += chunk.delta;
          onChunk(chunk.delta, result);
        }
      },
    );
    log.info('笔记流式调用完成', { signalAborted: signal?.aborted });
  } catch (e: any) {
    log.info('笔记流式调用异常', {
      errorName: e?.name,
      errorMessage: e?.message,
      signalAborted: signal?.aborted,
    });
    throw e;
  }

  log.info('笔记流式分析完成', { length: result.length, preview: result.slice(0, 80) });
  return result;
}
