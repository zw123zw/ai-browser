import type { ChatRequestOptions, StreamChunk } from '@/src/types';

/**
 * 协议适配器基类
 * 所有大厂协议只需要继承并实现差异部分
 */
export abstract class BaseAdapter {
  /** 协议名 */
  abstract readonly name: string;

  /**
   * 发送对话请求（流式）
   * @param opts 请求参数
   * @param onChunk 每收到一段回调
   */
  abstract chat(
    opts: ChatRequestOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void>;

  /** 通用 SSE 解析工具：把 ReadableStream 解析成一行行 data: ... */
  protected async *parseSSE(
    response: Response
  ): AsyncGenerator<string, void, unknown> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || !line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        yield data;
      }
    }
  }
}
