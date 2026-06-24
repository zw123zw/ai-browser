import { proxyFetchStream } from './proxy';
import type { ProxyRequestOptions } from './proxy';
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

  /**
   * 代理流式请求（统一入口）
   *
   * - 代理成功 → 正常返回
   * - 请求中止 → 直接抛出 AbortError（不走降级，避免建立新连接）
   * - 其他错误 → 原样抛出，由调用方决定是否降级
   *
   * 所有适配器应优先使用此方法而非直接调用 proxyFetchStream，
   * 确保 abort 行为统一，新适配器无需额外处理。
   */
  protected async proxyStream(
    opts: ProxyRequestOptions,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    try {
      await proxyFetchStream(opts, onChunk);
    } catch (error) {
      // 中止时直接抛出，不走降级逻辑（避免建立新的 SSE 连接）
      if (opts.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      throw error;
    }
  }

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
