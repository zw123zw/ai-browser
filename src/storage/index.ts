import { storage } from 'wxt/storage';
import type { AppSettings, Conversation } from '@/src/types';

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  maxContext: 20,
  maxConversations: 50,
  defaultModelId: 'claude-opus-4-7',
  drawerWidth: 80,
  primaryColor: '#10b981',
  shortcut: 'Ctrl+Shift+M',
  models: [
    {
      id: 'claude-opus-4-7',
      label: 'Claude Opus 4.7',
      provider: 'openai',
      modelName: 'claude-opus-4-7',
      vision: true,
    },
    {
      id: 'kimi-k2.5',
      label: 'Kimi K2.5',
      provider: 'openai',
      modelName: 'kimi-k2.5',
    },
    {
      id: 'glm-5.1',
      label: 'GLM-5.1',
      provider: 'openai',
      modelName: 'glm-5.1',
    },
  ],
};

/** 存储键 —— 都用 zwf- 命名空间 */
const KEY_SETTINGS = 'local:zwf-settings';
const KEY_CONVERSATIONS = 'local:zwf-conversations';
const KEY_ACTIVE_ID = 'local:zwf-active-id';
const KEY_FAB_POS = 'local:zwf-fab-pos';

export const settingsStorage = storage.defineItem<AppSettings>(KEY_SETTINGS, {
  fallback: DEFAULT_SETTINGS,
});

export const conversationsStorage = storage.defineItem<Conversation[]>(
  KEY_CONVERSATIONS,
  { fallback: [] }
);

export const activeIdStorage = storage.defineItem<string>(KEY_ACTIVE_ID, {
  fallback: '',
});

/** 悬浮按钮位置 (距离视口右下角) */
export interface FabPos {
  right: number;
  bottom: number;
}
export const fabPosStorage = storage.defineItem<FabPos>(KEY_FAB_POS, {
  fallback: { right: 24, bottom: 24 },
});
