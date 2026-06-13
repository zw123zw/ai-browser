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
      const hasImages = m.images && m.images.length;
      const hasFileAttachments = m.attachments?.some(a => a.type !== 'image' && a.content);

      // 有图片或文件附件时，使用 content array
      if (hasImages || hasFileAttachments) {
        const parts: any[] = [];

        // 文件内容拼入文本部分
        let textContent = m.content;
        if (hasFileAttachments) {
          const fileTexts = m.attachments!
            .filter(a => a.type !== 'image' && a.content && !a.content.startsWith('['))
            .map(a => `[文件: ${a.name}]\n\`\`\`${a.lang || ''}\n${a.content}\n\`\`\``)
            .join('\n\n');
          if (fileTexts) {
            textContent = textContent ? `${textContent}\n\n${fileTexts}` : fileTexts;
          }
        }

        parts.push({ type: 'text', text: textContent });

        // 图片附件
        if (hasImages) {
          for (const url of m.images!) {
            parts.push({ type: 'image_url', image_url: { url } });
          }
        }
        // 新格式 attachments 中的图片
        if (m.attachments) {
          for (const att of m.attachments) {
            if (att.type === 'image' && att.dataUrl) {
              parts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
            }
          }
        }

        return { role: m.role, content: parts };
      }
      return { role: m.role, content: m.content };
    });
  }

  async chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    // 根据 apiFormat 和 baseUrl 智能判断协议类型
    const base = opts.baseUrl.replace(/\/$/, '');

    // 判断是否为 Anthropic 协议（apiFormat 优先级高于 URL 推断）
    const isAnthropic = opts.apiFormat === 'anthropic'
      || base.includes('/anthropic');

    // 智能拼接 URL
    let url: string;

    // 检查 baseUrl 是否已包含完整路径
    const hasCompletePath = base.endsWith('/chat/completions')
      || base.endsWith('/messages');

    if (hasCompletePath) {
      // baseUrl 已包含完整路径，直接使用
      url = base;
    } else if (isAnthropic) {
      // Anthropic 格式：拼接 /v1/messages
      url = base.includes('/v1') ? `${base}/messages` : `${base}/v1/messages`;
    } else {
      // OpenAI 兼容格式：拼接 /chat/completions
      // 不自动加 /v1，因为 baseUrl 可能已包含版本路径（如 /v4）
      url = `${base}/chat/completions`;
    }

    log.debug('请求开始', { url, model: opts.modelName });

    const startTime = Date.now();

    // 根据 API 格式设置不同的 headers 和 body
    let headers: Record<string, string>;
    let body: string;

    if (isAnthropic) {
      // Anthropic 格式
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: opts.modelName,
        messages: this.toRequestMessages(opts.messages),
        max_tokens: 8192,
        stream: true,
      });
    } else {
      // OpenAI 兼容格式
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      };
      body = JSON.stringify({
        model: opts.modelName,
        messages: this.toRequestMessages(opts.messages),
        stream: true,
      });
    }

    let chunkCount = 0;
    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onChunk({ done: true });
    };

    // 解析 SSE 数据块（支持 OpenAI 和 Anthropic 格式）
    const processChunk = (data: string) => {
      // 跳过空数据
      if (!data || data.trim() === '') return;

      try {
        const json = JSON.parse(data);

        if (isAnthropic) {
          // Anthropic 格式的事件类型
          switch (json.type) {
            case 'content_block_delta':
              // 文本增量
              if (json.delta?.type === 'text_delta' && json.delta.text) {
                const chunk: StreamChunk = { delta: json.delta.text };
                chunkCount++;
                onChunk(chunk);
              }
              // 思考增量（Claude 3.7+ 支持）
              if (json.delta?.type === 'thinking_delta' && json.delta.thinking) {
                const chunk: StreamChunk = { reasoningDelta: json.delta.thinking };
                chunkCount++;
                onChunk(chunk);
              }
              break;

            case 'message_delta':
              // 消息结束
              if (json.delta?.stop_reason) {
                fireDone();
              }
              break;

            case 'message_stop':
              // 流结束
              fireDone();
              break;

            case 'ping':
            case 'message_start':
            case 'content_block_start':
            case 'content_block_stop':
              // 忽略这些事件
              break;

            default:
              log.debug('未知 Anthropic 事件类型:', json.type);
          }
        } else {
          // OpenAI 格式
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
        }
      } catch {
        // 跳过非法 chunk
      }
    };

    // 尝试通过代理请求（避免 CORS）
    try {
      let buffer = '';
      let eventType = ''; // 记录 Anthropic 事件类型
      await proxyFetchStream({ url, method: 'POST', headers, body, signal: opts.signal }, (chunk) => {
        buffer += chunk;
        // 按行分割处理
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后不完整的行
        for (const line of lines) {
          const trimmedLine = line.trim();

          // 处理 Anthropic 的 event 行
          if (trimmedLine.startsWith('event: ')) {
            eventType = trimmedLine.slice(7).trim();
            continue;
          }

          // 处理 data 行
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);

            // OpenAI 格式的结束标记
            if (data === '[DONE]') {
              fireDone();
              return;
            }

            // 解析数据
            processChunk(data);
          }
        }
      });
      fireDone();
      log.debug('代理请求完成', { chunks: chunkCount, duration: `${Date.now() - startTime}ms` });
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
        // Anthropic 错误格式: { "type": "error", "error": { "type": "...", "message": "..." } }
        if (j?.error?.message) {
          msg = j.error.message;
        }
        // OpenAI 错误格式: { "error": { "message": "...", "type": "...", "code": "..." } }
        else if (j?.error?.type) {
          msg = `${j.error.type}: ${j.error.message || msg}`;
        }
        // 通用错误格式
        else if (j?.message) {
          msg = j.message;
        }
      } catch {}
      log.error('请求失败', { status: res.status, message: msg, apiFormat: opts.apiFormat, isAnthropic });
      throw new Error(`HTTP ${res.status}：${msg}`);
    }

    for await (const data of this.parseSSE(res)) {
      processChunk(data);
    }
    fireDone();
    log.debug('直接请求完成', { chunks: chunkCount, duration: `${Date.now() - startTime}ms` });
  }
}
