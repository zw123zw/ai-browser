import type { Provider } from '@/src/types';
import { BaseAdapter } from './base';
import { OpenAIAdapter } from './openai';
import { QwenAdapter } from './qwen';
import { WenxinAdapter } from './wenxin';

/**
 * 工厂：根据 provider 创建适配器
 *
 * 大部分国内模型都兼容 OpenAI 协议，直接使用 OpenAI 适配器即可
 * 只有特殊协议的模型才需要单独的适配器
 */
export function createAdapter(provider: Provider): BaseAdapter {
  switch (provider) {
    case 'qwen':
      return new QwenAdapter();
    case 'wenxin':
      return new WenxinAdapter();
    // 以下模型都兼容 OpenAI 协议
    case 'openai':
    case 'zhipu':      // 智谱清言
    case 'deepseek':   // DeepSeek
    case 'moonshot':   // Moonshot (Kimi)
    case 'anthropic':  // Anthropic Claude
    case 'gemini':     // Google Gemini
    default:
      return new OpenAIAdapter();
  }
}
