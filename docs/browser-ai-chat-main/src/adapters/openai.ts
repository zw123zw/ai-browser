import { BaseAdapter } from './base';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

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
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.modelName,
        messages: this.toRequestMessages(opts.messages),
        stream: true,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j?.error?.message) msg = j.error.message;
        else if (j?.message) msg = j.message;
      } catch {
        // 非 JSON，使用原文
      }
      throw new Error(`HTTP ${res.status}：${msg}`);
    }

    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onChunk({ done: true });
    };

    for await (const data of this.parseSSE(res)) {
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        // 跳过非法 chunk（如 keep-alive 心跳）
        continue;
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || choice.message || {};
      const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
      const content = delta.content ?? delta.text;
      const chunk: StreamChunk = {};
      if (reasoning) chunk.reasoningDelta = reasoning;
      if (content) chunk.delta = content;
      if (chunk.delta || chunk.reasoningDelta) onChunk(chunk);
      if (choice.finish_reason) fireDone();
    }
    fireDone();
  }
}
