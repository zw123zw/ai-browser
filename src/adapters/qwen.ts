/**
 * 通义千问（阿里）协议适配器
 *
 * 使用 OpenAI 兼容接口
 * 文档: https://help.aliyun.com/zh/dashscope/developer-reference/api-details
 */

import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
// proxyStream 继承自 BaseAdapter
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:Qwen');

export class QwenAdapter extends BaseAdapter {
  readonly name = 'qwen';

  /** 提取 system 消息（Qwen 原生 API 用独立的 system 字段） */
  private extractSystem(messages: ChatMessage[]): string | undefined {
    const systemMsgs = messages.filter(m => m.role === 'system');
    if (!systemMsgs.length) return undefined;
    return systemMsgs.map(m => m.content).join('\n');
  }

  private toRequestMessages(messages: ChatMessage[]) {
    return messages
      .filter(m => m.role !== 'system')
      .map((m) => {
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
    const url = `${opts.baseUrl.replace(/\/$/, '')}/services/aigc/text-generation/generation`;
    log.info('请求开始', { url, model: opts.modelName, messages: opts.messages.length + '条' });

    const startTime = Date.now();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    };
    const bodyObj: Record<string, unknown> = {
      model: opts.modelName,
      input: {
        messages: this.toRequestMessages(opts.messages),
      },
      parameters: {
        result_format: 'message',
        incremental_output: true,
      },
    };

    // system 消息作为独立字段（Qwen 原生 API 要求）
    const systemPrompt = this.extractSystem(opts.messages);
    if (systemPrompt) {
      (bodyObj.input as Record<string, unknown>).system = systemPrompt;
    }

    const body = JSON.stringify(bodyObj);

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
      await this.proxyStream({ url, method: 'POST', headers, body, signal: opts.signal }, (chunk) => {
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
      // 中止时不降级到直接请求
      if (opts.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
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
    const duration2 = Date.now() - startTime;
    log.info('请求完成', { duration: `${duration2}ms` });
  }
}
