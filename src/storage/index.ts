import { storage } from 'wxt/storage';
import type { AppSettings, Conversation } from '@/src/types';

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiFormat: 'open-chat',
  authField: 'bearer',
  defaultModelId: 'gpt-4o',
  drawerWidth: 80,
  primaryColor: '#4f46e5',
  theme: 'classic',
  shortcut: 'Ctrl+Shift+M',
  models: [
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      provider: 'openai',
      modelName: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiFormat: 'open-chat',
      authField: 'bearer',
    },
    {
      id: 'gpt-4o-mini',
      label: 'GPT-4o Mini',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiFormat: 'open-chat',
      authField: 'bearer',
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
