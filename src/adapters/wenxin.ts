/**
 * 文心一言（百度）协议适配器
 *
 * 使用百度千帆大模型平台接口
 * 文档: https://cloud.baidu.com/doc/WENXINWORKSHOP/s/jlil56u11
 */

import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:Wenxin');

export class WenxinAdapter extends BaseAdapter {
  readonly name = 'wenxin';

  private toRequestMessages(messages: ChatMessage[]) {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
  }

  async chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    // 文心一言使用 access_token 认证
    // 这里假设 baseUrl 已经包含 access_token 参数
    // 或者使用 API Key + Secret Key 动态获取
    const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
    log.info('请求开始', { url });

    const startTime = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
        if (j?.error_msg) msg = j.error_msg;
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

      // 文心一言流式响应格式
      if (json.error_code) {
        throw new Error(`文心一言错误: ${json.error_msg || json.error_code}`);
      }

      const result = json.result;
      if (result) {
        onChunk({ delta: result });
      }

      if (json.is_end) {
        fireDone();
      }
    }
    fireDone();
  }
}
