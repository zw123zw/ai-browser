/**
 * 通义千问（阿里）协议适配器
 *
 * 使用 OpenAI 兼容接口
 * 文档: https://help.aliyun.com/zh/dashscope/developer-reference/api-details
 */

import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
import { proxyFetchStream } from './proxy';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:Qwen');

export class QwenAdapter extends BaseAdapter {
  readonly name = 'qwen';

  private toRequestMessages(messages: ChatMessage[]) {
    return messages.map((m) => {
      // 将文件附件内容合并到文本
      let content = m.content;
      if (m.attachments?.some(a => a.type !== 'image' && a.content && !a.content.startsWith('['))) {
        const fileTexts = m.attachments
          .filter(a => a.type !== 'image' && a.content && !a.content.startsWith('['))
          .map(a => `[文件: ${a.name}]\n\`\`\`${a.lang || ''}\n${a.content}\n\`\`\``)
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
    const url = `${opts.baseUrl.replace(/\/$/, '')}/services/aigc/text-generation/generation`;
    log.info('请求开始', { url, model: opts.modelName });

    const startTime = Date.now();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    };
    const body = JSON.stringify({
      model: opts.modelName,
      input: {
        messages: this.toRequestMessages(opts.messages),
      },
      parameters: {
        result_format: 'message',
        incremental_output: true,
      },
    });

    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onChunk({ done: true });
    };

    // 解析 Qwen 特有的响应格式
    const processChunk = (data: string) => {
      try {
        const json = JSON.parse(data);
        const output = json.output;
        if (!output) return;

        const choices = output.choices;
        if (choices && choices.length > 0) {
          const choice = choices[0];
          const content = choice.message?.content;
          if (content) {
            onChunk({ delta: content });
          }
          if (choice.finish_reason) {
            fireDone();
          }
        }
      } catch {}
    };

    // 尝试通过代理请求
    try {
      let buffer = '';
      await proxyFetchStream({ url, method: 'POST', headers, body }, (chunk) => {
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
      log.info('代理请求完成', { duration: `${Date.now() - startTime}ms` });
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
        if (j?.message) msg = j.message;
        else if (j?.error?.message) msg = j.error.message;
      } catch {}
      log.error('请求失败', { status: res.status, message: msg });
      throw new Error(`HTTP ${res.status}：${msg}`);
    }

    for await (const data of this.parseSSE(res)) {
      processChunk(data);
    }
    fireDone();
    log.info('直接请求完成', { duration: `${Date.now() - startTime}ms` });
  }
}
