import type { Provider } from '@/src/types';
import { BaseAdapter } from './base';
import { OpenAIAdapter } from './openai';
import { QwenAdapter } from './qwen';
import { WenxinAdapter } from './wenxin';
import { GeminiAdapter } from './gemini';
import { DoubaoAdapter } from './doubao';
import type { ChatRequestOptions, StreamChunk } from '@/src/types';

/**
 * 工厂：根据 provider 创建适配器
 *
 * 大部分模型都兼容 OpenAI 协议，直接使用 OpenAI 适配器
 * 只有特殊协议的模型才需要单独的适配器
 */
export function createAdapter(provider: Provider): BaseAdapter {
  let adapter: BaseAdapter;
  switch (provider) {
    case 'qwen':
      adapter = new QwenAdapter();
      break;
    case 'wenxin':
      adapter = new WenxinAdapter();
      break;
    case 'gemini':
      adapter = new GeminiAdapter();
      break;
    case 'doubao':
      adapter = new DoubaoAdapter();
      break;
    // 以下模型都兼容 OpenAI 协议
    case 'openai':
    case 'zhipu':      // 智谱清言
    case 'deepseek':   // DeepSeek
    case 'moonshot':   // Moonshot (Kimi)
    case 'anthropic':  // Anthropic Claude
    case 'grok':       // Grok (xAI)
    case 'custom':     // 自定义 OpenAI 兼容
    default:
      adapter = new OpenAIAdapter();
  }

  // Wrap chat() with license validation
  const originalChat = adapter.chat.bind(adapter);
  adapter.chat = async (opts: ChatRequestOptions, onChunk: (chunk: StreamChunk) => void) => {
    const { checkLicense } = await import('@/src/license/wasm-loader');
    const status = await checkLicense();
    if (status.expired || status.status === 'expired') {
      window.dispatchEvent(new CustomEvent('aib-show-expired'));
      throw new Error('License expired');
    }
    return originalChat(opts, onChunk);
  };

  return adapter;
}
