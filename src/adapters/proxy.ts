/**
 * 代理请求工具
 *
 * 通过 background script 发送请求，避免 CORS 限制
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('API');

export interface ProxyRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface ProxyResponse {
  success: boolean;
  data?: any;
  status?: number;
  error?: string;
}

/** 格式化请求体（隐藏 apiKey） */
function bodySummary(body?: string): string {
  if (!body) return ''
  try {
    const parsed = JSON.parse(body)
    // 隐藏 apiKey
    if (parsed.apiKey) parsed.apiKey = '***'
    return JSON.stringify(parsed, null, 2)
  } catch {
    return body
  }
}

/**
 * 通过 background script 代理请求
 */
export async function proxyFetch(options: ProxyRequestOptions): Promise<ProxyResponse> {
  try {
    // 检查是否在扩展环境
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('不在扩展环境中');
    }

    const { url, method, headers, body } = options
    log.info(`→ ${method || 'POST'} ${url}`, { headers, body: bodySummary(body) })

    const startTime = Date.now();
    const response = await chrome.runtime.sendMessage({
      type: 'proxy-fetch',
      url,
      method,
      headers,
      body,
    });

    const duration = Date.now() - startTime

    if (!response?.success) {
      log.error(`✗ ${url} - ${response?.error || '代理请求失败'}`, { duration: `${duration}ms` })
      throw new Error(response?.error || '代理请求失败');
    }

    log.info(`← ${url} ${response.status || 'OK'} ${duration}ms`, { data: response.data })
    return response;
  } catch (error) {
    log.error(`✗ ${options.url} - ${error}`)
    throw error;
  }
}

/**
 * 流式代理请求
 *
 * @returns 返回一个异步迭代器，用于读取流式数据
 */
export async function proxyFetchStream(
  options: ProxyRequestOptions,
  onChunk: (chunk: string) => void
): Promise<void> {
  try {
    // 检查是否在扩展环境
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('不在扩展环境中');
    }

    const { url, method, headers, body } = options
    log.info(`→ [stream] ${method || 'POST'} ${url}`, { headers, body: bodySummary(body) })

    const startTime = Date.now();

    // 用于存储请求 ID，便于中止
    let requestId: string | null = null;
    let aborted = false;

    // 先注册监听器，再发消息，避免竞态
    const chunkListener = (msg: any) => {
      if (msg.type === 'stream-chunk' && msg.requestId === requestId && !aborted) {
        onChunk(msg.chunk);
      }
    };

    // 发起请求
    const response = await chrome.runtime.sendMessage({
      type: 'proxy-fetch-stream',
      url,
      method,
      headers,
      body,
    });

    if (!response?.success) {
      log.error(`✗ [stream] ${url} - ${response?.error || '流式请求失败'}`)
      throw new Error(response?.error || '流式请求失败');
    }

    requestId = response.requestId;
    log.debug(`→ [stream] 已启动 requestId=${requestId}`)

    // ★ 如果在 requestId 赋值前就已经 abort，立即拒绝
    if (aborted || options.signal?.aborted) {
      log.info(`⊘ [stream] ${url} 已中止（请求启动前）`)
      chrome.runtime.sendMessage({ type: 'abort-stream', requestId }).catch(() => {});
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    // 注册监听器（在 sendMessage 之后但在流数据到达之前）
    chrome.runtime.onMessage.addListener(chunkListener);

    // 监听 abort signal（设标记 + 通知 background 中止 fetch）
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        log.debug(`→ [stream] 收到中止信号 requestId=${requestId}`)
        chrome.runtime.sendMessage({ type: 'abort-stream', requestId }).catch(() => {});
      }, { once: true });
    }

    // 等待流结束或错误
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(chunkListener);
        chrome.runtime.onMessage.removeListener(endListener);
        chrome.runtime.onMessage.removeListener(errorListener);
      };

      const endListener = (msg: any) => {
        if (msg.type === 'stream-end' && msg.requestId === requestId) {
          const duration = Date.now() - startTime
          cleanup();
          if (settled) return
          settled = true
          if (aborted) {
            log.info(`⊘ [stream] ${url} 已中止 ${duration}ms`)
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          } else {
            log.info(`← [stream] ${url} 完成 ${duration}ms`)
            resolve();
          }
        }
      };

      const errorListener = (msg: any) => {
        if (msg.type === 'stream-error' && msg.requestId === requestId) {
          const duration = Date.now() - startTime
          log.error(`✗ [stream] ${url} 中断 ${duration}ms - ${msg.error || '未知错误'}`)
          cleanup();
          if (settled) return
          settled = true
          reject(new Error(msg.error || '流式请求中断'));
        }
      };

      // 检查是否已经中止
      if (aborted || options.signal?.aborted) {
        log.info(`⊘ [stream] ${url} 已中止`)
        cleanup();
        if (!settled) { settled = true; reject(new DOMException('The operation was aborted.', 'AbortError')); }
        return;
      }

      // abort 时立即 reject，不等 stream-end
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          if (settled) return
          settled = true
          cleanup()
          log.info(`⊘ [stream] ${url} abort 立即 reject`)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }, { once: true })
      }

      chrome.runtime.onMessage.addListener(endListener);
      chrome.runtime.onMessage.addListener(errorListener);
    });
  } catch (error) {
    log.error(`✗ [stream] ${options.url} - ${error}`)
    throw error;
  }
}
