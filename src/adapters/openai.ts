import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
import { proxyFetchStream, proxyFetch } from './proxy';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:OpenAI');

/**
 * OpenAI 协议适配器（默认实现）
 *
 * 拓展其它协议时，参照该类实现 chat 方法即可：
 * - 改请求 URL / Headers
 * - 改 body 结构
 * - 改流式 chunk 解析
 */
export class OpenAIAdapter extends BaseAdapter {
  readonly name = 'openai';

  /** 把内部 ChatMessage 转成 OpenAI 协议消息 */
  private toRequestMessages(messages: ChatMessage[]) {
    return messages.map((m) => {
      // 多模态：有图片就用 content array，否则纯文本
      if (m.images && m.images.length) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...m.images.map((url) => ({
              type: 'image_url',
              image_url: { url },
            })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  async chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
    log.info('请求开始', { url, model: opts.modelName, messageCount: opts.messages.length, hasApiKey: !!opts.apiKey, hasSignal: !!opts.signal });

    const startTime = Date.now();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    };
    const body = JSON.stringify({
      model: opts.modelName,
      messages: this.toRequestMessages(opts.messages),
      stream: true,
    });

    let chunkCount = 0;
    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onChunk({ done: true });
    };

    // 解析 SSE 数据块
    const processChunk = (data: string) => {
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) return;

        const delta = choice.delta || choice.message || {};
        const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
        const content = delta.content ?? delta.text;
        const chunk: StreamChunk = {};
        if (reasoning) chunk.reasoningDelta = reasoning;
        if (content) chunk.delta = content;
        if (chunk.delta || chunk.reasoningDelta) {
          chunkCount++;
          onChunk(chunk);
        }
        if (choice.finish_reason) fireDone();
      } catch {
        // 跳过非法 chunk
      }
    };

    // 尝试通过代理请求（避免 CORS）
    try {
      let buffer = '';
      await proxyFetchStream({ url, method: 'POST', headers, body }, (chunk) => {
        buffer += chunk;
        // 按行分割处理
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后不完整的行
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            processChunk(line.slice(6));
          }
        }
      });
      fireDone();
      log.info('代理请求完成', { chunks: chunkCount, duration: `${Date.now() - startTime}ms` });
      return;
    } catch (proxyError) {
      log.warn('代理请求失败，尝试直接请求:', proxyError);
    }

    // 直接请求（降级方案）
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j?.error?.message) msg = j.error.message;
        else if (j?.message) msg = j.message;
      } catch {}
      log.error('请求失败', { status: res.status, message: msg });
      throw new Error(`HTTP ${res.status}：${msg}`);
    }

    for await (const data of this.parseSSE(res)) {
      processChunk(data);
    }
    fireDone();
    log.info('直接请求完成', { chunks: chunkCount, duration: `${Date.now() - startTime}ms` });
  }
}
