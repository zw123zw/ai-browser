import type { Provider } from '@/src/types';
import { BaseAdapter } from './base';
import { OpenAIAdapter } from './openai';

/**
 * 工厂：根据 provider 创建适配器
 *
 * 拓展新协议步骤：
 * 1. 新建 src/adapters/xxx.ts，继承 BaseAdapter，只实现差异部分
 * 2. 在下面 switch 中加一个 case 即可
 */
export function createAdapter(provider: Provider): BaseAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAIAdapter();
    // case 'anthropic':
    //   return new AnthropicAdapter();
    // case 'gemini':
    //   return new GeminiAdapter();
    default:
      // 未实现的协议默认走 OpenAI 兼容
      return new OpenAIAdapter();
  }
}
