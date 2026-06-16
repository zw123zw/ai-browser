import { storage } from 'wxt/storage';
import type { AppSettings, Conversation, ModelConfig, Provider } from '@/src/types';
import rawModels from '@/src/local-config.json';

/** 从 local-config.json 映射到 ModelConfig */
function parseLocalModels(list: any[]): ModelConfig[] {
  return list.map((m) => {
    // baseUrl 末尾去掉 /chat/completions（adapter 会自动拼）
    let baseUrl = m.baseUrl || '';
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '');
    const id = m.id || m.modelName || m.model || `model-${Date.now()}`;
    const modelName = m.modelName || m.model || id;
    const label = m.label || modelName;
    const provider = (m.provider || (m.apiFormat === 'anthropic' ? 'anthropic' : 'openai')) as Provider;
    return {
      id,
      label,
      provider,
      modelName,
      baseUrl,
      apiKey: m.apiKey || '',
      apiFormat: m.apiFormat || 'openai',
      website: m.website || '',
    };
  });
}

const localModels = parseLocalModels(rawModels);

/** 默认设置（从 local-config.json 读取） */
export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  baseUrl: localModels[0]?.baseUrl || 'https://api.openai.com/v1',
  apiKey: localModels[0]?.apiKey || '',
  apiFormat: localModels[0]?.apiFormat || 'open-chat',
  authField: localModels[0]?.authField || 'bearer',
  defaultModelId: localModels[0]?.id || '',
  drawerWidth: 480,
  primaryColor: '#4f46e5',
  theme: 'classic',
  shortcut: 'Ctrl+`',
  maxConversations: 100,
  maxContext: 50,
  autoSendSelection: 'auto',
  models: localModels,
};

/** 存储键 —— 都用 zwf- 命名空间 */
const KEY_SETTINGS = 'local:zwf-settings';
/** @deprecated 旧的多会话存储键，仅用于迁移 */
const KEY_CONVERSATIONS_OLD = 'local:zwf-conversations';
const KEY_CONVERSATION = 'local:zwf-conversation';
const KEY_ACTIVE_ID = 'local:zwf-active-id'; // 保留兼容，不再使用
const KEY_FAB_POS = 'local:zwf-fab-pos';

export const settingsStorage = storage.defineItem<AppSettings>(KEY_SETTINGS, {
  fallback: DEFAULT_SETTINGS,
});

/** 单会话存储（新） */
export const conversationStorage = storage.defineItem<Conversation | null>(
  KEY_CONVERSATION,
  { fallback: null }
);

/** @deprecated 旧的多会话存储（仅迁移用） */
export const conversationsStorageOld = storage.defineItem<Conversation[]>(
  KEY_CONVERSATIONS_OLD,
  { fallback: [] }
);

/** 悬浮按钮位置 (距离视口右下角) */
export interface FabPos {
  right: number;
  bottom: number;
}
export const fabPosStorage = storage.defineItem<FabPos>(KEY_FAB_POS, {
  fallback: { right: 24, bottom: 24 },
});

/** 抽屉展开状态（跨页面持久化） */
export const drawerOpenStorage = storage.defineItem<boolean>('local:zwf-drawer-open', {
  fallback: false,
});
