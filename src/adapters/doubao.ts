/**
 * 豆包（字节火山引擎）协议适配器
 *
 * 使用 OpenAI 兼容接口
 * 文档: https://www.volcengine.com/docs/82379/1298454
 */

import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
import { proxyFetchStream } from './proxy';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:Doubao');

export class DoubaoAdapter extends BaseAdapter {
  readonly name = 'doubao';

  private toRequestMessages(messages: ChatMessage[]) {
    return messages.map((m) => {
      let content = m.content;
      if (m.attachments?.some(a => a.content)) {
        const fileTexts = m.attachments
          .filter(a => a.content)
          .map(a => {
            if (a.type === 'image') {
              return `[图片文字识别: ${a.name}]\n${a.content}`;
            }
            return `[文件: ${a.name}]\n\`\`\`${a.lang || ''}\n${a.content}\n\`\`\``;
          })
          .join('\n\n');
        if (fileTexts) content = content ? `${content}\n\n${fileTexts}` : fileTexts;
      }
      return { role: m.role, content };
    });
  }

  async chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    const base = opts.baseUrl.replace(/\/$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

    log.info('请求开始', { url, model: opts.modelName, messages: opts.messages.length + '条' });

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

    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onChunk({ done: true });
    };

    const processChunk = (data: string) => {
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) return;

        const delta = choice.delta || choice.message || {};
        const content = delta.content;
        if (content) {
          onChunk({ delta: content });
        }
        if (choice.finish_reason) {
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
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            processChunk(line.slice(6));
          }
        }
      });
      fireDone();
      const duration = Date.now() - startTime;
      log.info('请求完成', { duration: `${duration}ms` });
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
        else if (j?.message) msg = j.message;
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
  }
}
