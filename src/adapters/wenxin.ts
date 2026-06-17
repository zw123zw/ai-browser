/**
 * 文心一言（百度）协议适配器
 *
 * 使用百度千帆大模型平台接口
 * 文档: https://cloud.baidu.com/doc/WENXINWORKSHOP/s/jlil56u11
 */

import { BaseAdapter } from './base';
import { Logger } from '@/src/utils/logger';
import { saveApiLog } from '@/src/utils/log-storage';
import { proxyFetchStream } from './proxy';
import type { ChatMessage, ChatRequestOptions, StreamChunk } from '@/src/types';

const log = new Logger('Adapter:Wenxin');

export class WenxinAdapter extends BaseAdapter {
  readonly name = 'wenxin';

  private toRequestMessages(messages: ChatMessage[]) {
    return messages.map((m) => {
      // 将文件附件内容合并到文本（含图片 OCR 文字）
      let content = m.content;
      if (m.attachments?.some(a => a.content && !a.content.startsWith('['))) {
        const fileTexts = m.attachments
          .filter(a => a.content && !a.content.startsWith('['))
          .map(a => {
            if (a.type === 'image') {
              return `[图片文字识别: ${a.name}]\n${a.content}`;
            }
            return `[文件: ${a.name}]\n\`\`\`${a.lang || ''}\n${a.content}\n\`\`\``;
          })
          .join('\n\n');
        if (fileTexts) content = content ? `${content}\n\n${fileTexts}` : fileTexts;
      }
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
    });
  }

  async chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
    log.info('请求开始', { url, messages: opts.messages.length + '条' });

    const startTime = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      messages: this.toRequestMessages(opts.messages),
      stream: true,
    });

    let fullResponse = '';
    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onChunk({ done: true });
    };

    // 解析文心一言响应格式
    const processChunk = (data: string) => {
      try {
        const json = JSON.parse(data);
        if (json.error_code) {
          throw new Error(`文心一言错误: ${json.error_msg || json.error_code}`);
        }
        const result = json.result;
        if (result) {
          fullResponse += result;
          onChunk({ delta: result });
        }
        if (json.is_end) {
          fireDone();
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('文心一言错误')) {
          throw e;
        }
      }
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
        if (j?.error_msg) msg = j.error_msg;
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
    saveApiLog('INFO', 'API', `← ${url} 响应 (${duration2}ms):\n${fullResponse}`);
  }
}
