/**
 * Google Gemini 协议适配器
 *
 * 使用 Google Generative Language API
 * 文档: https://ai.google.dev/api/generate-content
 */

import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
import { saveApiLog } from '@/src/utils/log-storage';
import { proxyFetchStream } from './proxy';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:Gemini');

export class GeminiAdapter extends BaseAdapter {
  readonly name = 'gemini';

  /** 提取 system 消息（Gemini 用 systemInstruction 字段） */
  private extractSystem(messages: ChatMessage[]): string | undefined {
    const systemMsgs = messages.filter(m => m.role === 'system');
    if (!systemMsgs.length) return undefined;
    return systemMsgs.map(m => m.content).join('\n');
  }

  /** 转换为 Gemini contents 格式 */
  private toContents(messages: ChatMessage[]) {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }

  async chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    const base = opts.baseUrl.replace(/\/$/, '');
    // 默认端点: /v1beta/models/{model}:streamGenerateContent
    const url = base.includes(':streamGenerateContent')
      ? base
      : `${base}/v1beta/models/${opts.modelName}:streamGenerateContent?alt=sse`;

    log.info('请求开始', { url, model: opts.modelName, messages: opts.messages.length + '条' });

    const startTime = Date.now();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-key': opts.apiKey,
    };

    const bodyObj: Record<string, unknown> = {
      contents: this.toContents(opts.messages),
      generationConfig: {
        maxOutputTokens: 8192,
      },
    };

    const systemInstruction = this.extractSystem(opts.messages);
    if (systemInstruction) {
      bodyObj.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const body = JSON.stringify(bodyObj);

    let fullResponse = '';
    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onChunk({ done: true });
    };

    const processChunk = (data: string) => {
      try {
        const json = JSON.parse(data);
        const candidates = json.candidates;
        if (!candidates?.length) return;

        const candidate = candidates[0];
        const parts = candidate.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              if (part.thought) {
                // 思考内容（Gemini 2.0+ thinking model）
                onChunk({ reasoningDelta: part.text });
              } else {
                // 正式回复
                fullResponse += part.text;
                onChunk({ delta: part.text });
              }
            }
          }
        }

        if (candidate.finishReason && candidate.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
          fireDone();
        }
      } catch {}
    };

    // 尝试通过代理请求
    try {
      let buffer = '';
      await proxyFetchStream({ url, method: 'POST', headers, body, signal: opts.signal }, (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            processChunk(trimmedLine.slice(6));
          }
        }
      });
      fireDone();
      const duration = Date.now() - startTime;
      log.info('请求完成', { duration: `${duration}ms` });
      saveApiLog('INFO', 'API', `← [stream] ${url} 响应 (${duration}ms):\n${fullResponse}`);
      return;
    } catch (proxyError) {
      log.warn('代理请求失败，尝试直接请求:', proxyError);
    }

    // 直接请求
    const res = await fetch(url, { method: 'POST', headers, body, signal: opts.signal });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j?.error?.message) msg = j.error.message;
      } catch {}
      log.error('请求失败', { status: res.status, message: msg });
      throw new Error(`HTTP ${res.status}：${msg}`);
    }

    for await (const data of this.parseSSE(res)) {
      processChunk(data);
    }
    fireDone();
    const duration2 = Date.now() - startTime;
    log.info('请求完成', { duration: `${duration2}ms` });
    saveApiLog('INFO', 'API', `← ${url} 响应 (${duration2}ms):\n${fullResponse}`);
  }
}
