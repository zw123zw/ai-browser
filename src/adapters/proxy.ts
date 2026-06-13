/**
 * 代理请求工具
 *
 * 通过 background script 发送请求，避免 CORS 限制
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('Proxy');

export interface ProxyRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  success: boolean;
  data?: any;
  status?: number;
  error?: string;
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

    log.info('代理请求:', { url: options.url, method: options.method });

    const response = await chrome.runtime.sendMessage({
      type: 'proxy-fetch',
      url: options.url,
      method: options.method,
      headers: options.headers,
      body: options.body,
    });

    if (!response?.success) {
      throw new Error(response?.error || '代理请求失败');
    }

    return response;
  } catch (error) {
    log.error('代理请求失败:', error);
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

    log.info('流式代理请求:', { url: options.url, method: options.method });

    // 先注册监听器，再发消息，避免竞态
    const chunkListener = (msg: any) => {
      if (msg.type === 'stream-chunk') {
        onChunk(msg.chunk);
      }
    };

    // 发起请求
    const response = await chrome.runtime.sendMessage({
      type: 'proxy-fetch-stream',
      url: options.url,
      method: options.method,
      headers: options.headers,
      body: options.body,
    });

    if (!response?.success) {
      throw new Error(response?.error || '流式请求失败');
    }

    // 注册监听器（在 sendMessage 之后但在流数据到达之前）
    chrome.runtime.onMessage.addListener(chunkListener);

    // 等待流结束或错误
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        chrome.runtime.onMessage.removeListener(chunkListener);
        chrome.runtime.onMessage.removeListener(endListener);
        chrome.runtime.onMessage.removeListener(errorListener);
      };

      const endListener = (msg: any) => {
        if (msg.type === 'stream-end') {
          cleanup();
          resolve();
        }
      };

      const errorListener = (msg: any) => {
        if (msg.type === 'stream-error') {
          cleanup();
          reject(new Error(msg.error || '流式请求中断'));
        }
      };

      chrome.runtime.onMessage.addListener(endListener);
      chrome.runtime.onMessage.addListener(errorListener);
    });
  } catch (error) {
    log.error('流式代理请求失败:', error);
    throw error;
  }
}
