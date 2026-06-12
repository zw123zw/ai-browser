/**
 * 通义千问（阿里）协议适配器
 *
 * 使用 OpenAI 兼容接口
 * 文档: https://help.aliyun.com/zh/dashscope/developer-reference/api-details
 */

import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:Qwen');

export class QwenAdapter extends BaseAdapter {
  readonly name = 'qwen';

  private toRequestMessages(messages: ChatMessage[]) {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  async chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    const url = `${opts.baseUrl.replace(/\/$/, '')}/services/aigc/text-generation/generation`;
    log.info('请求开始', { url, model: opts.modelName });

    const startTime = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.modelName,
        input: {
          messages: this.toRequestMessages(opts.messages),
        },
        parameters: {
          result_format: 'message',
          incremental_output: true,
        },
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j?.message) msg = j.message;
        else if (j?.error?.message) msg = j.error.message;
      } catch {
        // 非 JSON，使用原文
      }
      log.error('请求失败', { status: res.status, message: msg });
      throw new Error(`HTTP ${res.status}：${msg}`);
    }

    log.info('响应状态', { status: res.status });

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
        continue;
      }

      const output = json.output;
      if (!output) continue;

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
    }
    fireDone();
  }
}
