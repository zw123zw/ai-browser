import { storage } from 'wxt/storage';
import type { AppSettings, Conversation, ModelConfig, NotesData, Provider } from '@/src/types';
import rawModels from '@/src/local-config.json';
import voiceConfig from '@/src/voice-config.json';

/** 语音引擎类型 */
type EngineType = 'web-speech' | 'iflytek'

/** 语音设置 */
export interface VoiceSettings {
  engineType: EngineType
  iflytekAppId: string
  iflytekApiKey: string
  iflytekApiSecret: string
  recognitionLang: string
  wakeWord: string
  alwaysOnVoice: boolean
  enableTts: boolean
  ttsRate: number
  ttsVolume: number
  bufferTimeout: number
  idleTimeout: number
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  engineType: (voiceConfig.engineType as EngineType) || 'web-speech',
  iflytekAppId: voiceConfig.iflytekAppId || '',
  iflytekApiKey: voiceConfig.iflytekApiKey || '',
  iflytekApiSecret: voiceConfig.iflytekApiSecret || '',
  recognitionLang: 'zh-CN',
  wakeWord: '你好，小灵',
  alwaysOnVoice: false,
  enableTts: true,
  ttsRate: 1.8,
  ttsVolume: 0.8,
  bufferTimeout: 1500,
  idleTimeout: 3000,
}

/** 从 local-config.json 映射到 ModelConfig */
function parseLocalModels(list: any[]): ModelConfig[] {
  return list.map((m) => {
    // baseUrl 末尾去掉 /chat/completions（adapter 会自动拼）
    let baseUrl = m.baseUrl || '';
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '');
    const id = m.id || m.modelName || m.model || `model-${Date.now()}`;
    const modelName = m.modelName || m.model || id;
    const label = m.label || modelName;
    const provider = (m.provider || 'openai') as Provider;
    return {
      id,
      label,
      provider,
      modelName,
      baseUrl,
      apiKey: m.apiKey || '',
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
  authField: localModels[0]?.authField || 'bearer',
  defaultModelId: localModels[0]?.id || '',
  drawerWidth: 480,
  primaryColor: '#4f46e5',
  theme: 'classic',
  shortcut: 'Ctrl+`',
  maxConversations: 100,
  maxContext: 100,
  autoSendSelection: 'auto',
  translateTargetLang: '中文',
  translateMode: 'off',
  noteMode: 'off',
  automationEnabled: true,
  locale: 'zh-CN',
  models: localModels,
};

/** 存储键 */
const KEY_SETTINGS = 'local:ai-browser-settings';
const KEY_CONVERSATION = 'local:ai-browser-conversation';
const KEY_FAB_POS = 'local:ai-browser-fab-pos';

export const settingsStorage = storage.defineItem<AppSettings>(KEY_SETTINGS, {
  fallback: DEFAULT_SETTINGS,
});

/** 语音设置存储 */
export const voiceSettingsStorage = storage.defineItem<VoiceSettings>('local:voice-settings', {
  fallback: DEFAULT_VOICE_SETTINGS,
});

/** 单会话存储（新） */
export const conversationStorage = storage.defineItem<Conversation | null>(
  KEY_CONVERSATION,
  { fallback: null }
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
export const drawerOpenStorage = storage.defineItem<boolean>('local:ai-browser-drawer-open', {
  fallback: false,
});

/** 输入历史记录（跨标签页 + 跨浏览器重启持久化，上限 100 条） */
export const inputHistoryStorage = storage.defineItem<string[]>('local:ai-browser-input-history', {
  fallback: [],
});

/** 跨标签页排队任务（navigate/click 导航后，新页自动恢复执行） */
export interface QueuedTask {
  originalRequest: string
  completedSteps: Array<{ action: string; elementId?: string; description?: string }>
  recentMessages?: Array<{ role: string; content: string }>
  timestamp: number
}
export const queuedTaskStorage = storage.defineItem<QueuedTask | null>(
  'local:aib-queued-task',
  { fallback: null }
)

/** 笔记数据存储 */
export const notesStorage = storage.defineItem<NotesData>(
  'local:ai-browser-notes',
  { fallback: { titles: [] } }
)
