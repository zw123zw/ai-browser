<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import MarkdownIt from 'markdown-it';
import { useSettingsStore } from '@/src/stores/settings';
import { useConversationsStore } from '@/src/stores/conversations';
import { useToast } from '@/src/composables/useToast';
import { abortPipeline } from '@/src/composables/usePipeline';
import type { ModelConfig, NoteMode, Provider } from '@/src/types';
import { eventToShortcut } from '@/src/utils/shortcut';
import { THEMES } from '@/src/themes';
import { useI18n, type Locale } from '@/src/i18n';
import { useVoiceStore } from '@/src/stores/voice';
import ConfirmDialog from './ConfirmDialog.vue';

const emit = defineEmits<{ (e: 'close'): void }>();
const store = useSettingsStore();
const voiceStore = useVoiceStore();
const toast = useToast();
const { t, locale, setLocale } = useI18n();

const appVersion = '1.3.1';

// ========== License & 缓存 ==========
const licenseKey = ref('');
const logEnabled = !!import.meta.env.VITE_LOG_ENABLED;
const showClearCacheConfirm = ref(false);
const showAutomationConfirm = ref(false);
const pendingAutomationValue = ref(true);

const CACHE_LIMIT = 30 * 1024 * 1024; // 30MB
const cacheUsed = ref(0);

async function loadCacheSize() {
  try {
    cacheUsed.value = await chrome.storage.local.getBytesInUse();
  } catch {
    cacheUsed.value = 0;
  }
}

const cacheSizeText = computed(() => {
  const mb = cacheUsed.value / (1024 * 1024);
  return mb < 0.01 ? '0MB' : mb.toFixed(1) + 'MB';
});

const cachePercent = computed(() => Math.min(100, (cacheUsed.value / CACHE_LIMIT) * 100));

const cacheBarClass = computed(() => {
  if (cachePercent.value >= 80) return 'aib-cache-bar--danger';
  if (cachePercent.value >= 60) return 'aib-cache-bar--warn';
  return '';
});

function activateLicense() {
  // TODO: 激活逻辑暂未实现
  toast.info(t('settings.user.activateNotOpen'));
}

async function handleClearCache() {
  showClearCacheConfirm.value = true;
}

async function confirmClearCache() {
  showClearCacheConfirm.value = false;
  // 先中断所有进行中的请求
  await abortPipeline();
  const convStore = useConversationsStore();
  convStore.abort();
  await convStore.resetConversation();
  const { clearCache } = await import('@/src/utils/cache');
  await clearCache();
  toast.success(t('settings.user.cacheCleared'));
  await loadCacheSize();
}

onMounted(loadCacheSize);

async function handleDownloadLogs() {
  const { downloadLogs } = await import('@/src/utils/log-storage');
  await downloadLogs();
  toast.success(t('settings.user.logDownloaded'));
}

const tab = ref<'ai' | 'general' | 'user' | 'voice'>('ai');

// ========== 使用文档 ==========
const showDocs = ref(false);
const docsHtml = ref('');
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// 使用 Vite raw 导入 md 文件
import guideZh from '@/docs/site/guide-zh.md?raw';
import guideEn from '@/docs/site/guide-en.md?raw';

function openDocs() {
  showDocs.value = true;
  const content = locale.value === 'en-US' ? guideEn : guideZh;
  docsHtml.value = md.render(content);
}

function closeDocs() {
  showDocs.value = false;
  docsHtml.value = '';
}

// ========== 模型配置 ==========

// 本地模型列表副本
const localModels = ref<ModelConfig[]>(
  JSON.parse(JSON.stringify(store.settings.models))
);

// 当前选中的模型 id
const selectedModelId = ref(store.settings.defaultModelId || localModels.value[0]?.id || '');

// 当前编辑的表单
const form = reactive<ModelConfig>(getEmptyModel());

// API Key 显示切换
const showApiKey = ref(false);

// 是否是新建模式
const isNewMode = ref(false);

// 认证字段选项
const authFields = [
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api-key', label: 'API Key' },
  { value: 'access-token', label: 'Access Token' },
  { value: 'authorization', label: 'Authorization Header' },
];

// 供应商预设
interface ProviderPreset {
  name: string;
  baseUrl: string;
  authField: string;
  website: string;
  models: { label: string; modelName: string }[];
}

const providerPresets: Record<string, ProviderPreset> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authField: 'bearer',
    website: 'https://platform.openai.com/',
    models: [
      { label: 'GPT-4o', modelName: 'gpt-4o' },
      { label: 'GPT-4o Mini', modelName: 'gpt-4o-mini' },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authField: 'api-key',
    website: 'https://console.anthropic.com/',
    models: [
      { label: 'Claude Sonnet 4', modelName: 'claude-sonnet-4-20250514' },
      { label: 'Claude 3.5 Sonnet', modelName: 'claude-3-5-sonnet-20241022' },
    ],
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    authField: 'bearer',
    website: 'https://platform.deepseek.com/',
    models: [
      { label: 'DeepSeek Chat', modelName: 'deepseek-chat' },
      { label: 'DeepSeek R1', modelName: 'deepseek-reasoner' },
    ],
  },
  mimo: {
    name: 'MiMo',
    baseUrl: 'https://api.xiaomi.com/v1',
    authField: 'bearer',
    website: 'https://dev.mi.com/',
    models: [
      { label: 'MiMo 7B', modelName: 'MiMo-7B-RL' },
    ],
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    authField: 'bearer',
    website: 'https://dashscope.console.aliyun.com/',
    models: [
      { label: '通义千问 Max', modelName: 'qwen-max' },
      { label: '通义千问 Plus', modelName: 'qwen-plus' },
      { label: 'QwQ', modelName: 'qwq-plus' },
    ],
  },
  moonshot: {
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    authField: 'bearer',
    website: 'https://platform.moonshot.cn/',
    models: [
      { label: 'Moonshot V1 32K', modelName: 'moonshot-v1-32k' },
      { label: 'Moonshot V1 128K', modelName: 'moonshot-v1-128k' },
    ],
  },
  zhipu: {
    name: '智谱清言',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authField: 'bearer',
    website: 'https://open.bigmodel.cn/',
    models: [
      { label: 'GLM-4 Plus', modelName: 'glm-4-plus' },
      { label: 'GLM-4 Flash', modelName: 'glm-4-flash' },
    ],
  },
  baidu: {
    name: '文心一言',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
    authField: 'access-token',
    website: 'https://cloud.baidu.com/product/wenxinworkshop',
    models: [
      { label: '文心 4.5', modelName: 'ernie-4.5-8k' },
      { label: '文心 X1', modelName: 'ernie-x1-8k' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    authField: 'bearer',
    website: 'https://platform.minimaxi.com/',
    models: [
      { label: 'MiniMax-Text', modelName: 'MiniMax-Text-01' },
    ],
  },
  siliconflow: {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    authField: 'bearer',
    website: 'https://siliconflow.cn/',
    models: [
      { label: 'Qwen2.5 72B', modelName: 'Qwen/Qwen2.5-72B-Instruct' },
      { label: 'DeepSeek V3', modelName: 'deepseek-ai/DeepSeek-V3' },
    ],
  },
};

function getEmptyModel(): ModelConfig {
  return {
    id: '',
    label: '',
    provider: 'openai' as Provider,
    modelName: '',
    baseUrl: '',
    apiKey: '',
    authField: 'bearer',
    website: '',
  };
}

// 当前模型在列表中的索引（用于判断是否可删除）
const currentIndex = computed(() =>
  localModels.value.findIndex((m) => m.id === selectedModelId.value)
);

// 切换选中模型
function selectModel(id: string) {
  selectedModelId.value = id;
  isNewMode.value = false;
  showApiKey.value = false;
  const m = localModels.value.find((m) => m.id === id);
  if (m) Object.assign(form, JSON.parse(JSON.stringify(m)));
}

// 新建模型
function createNewModel() {
  isNewMode.value = true;
  showApiKey.value = false;
  Object.assign(form, getEmptyModel());
}

// 应用供应商预设（填充第一个模型名 + API 配置）
function applyPreset(presetKey: string) {
  const preset = providerPresets[presetKey];
  if (!preset) return;
  form.provider = presetKey as Provider;
  form.baseUrl = preset.baseUrl;
  form.authField = preset.authField;
  form.label = preset.name;
  form.website = preset.website;
  if (preset.models.length > 0) {
    form.modelName = preset.models[0].modelName;
  }
}

// 保存当前模型配置
async function saveModel() {
  const modelData: ModelConfig = {
    id: form.id || uuid(),
    label: form.label || form.modelName || t('settings.ai.unnamed'),
    provider: form.provider,
    modelName: form.modelName,
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    authField: form.authField,
    website: form.website,
  };

  if (isNewMode.value) {
    // 新建：添加到列表
    localModels.value = [...localModels.value, modelData];
    selectedModelId.value = modelData.id;
    isNewMode.value = false;
  } else {
    // 更新已有模型
    const idx = localModels.value.findIndex((m) => m.id === modelData.id);
    if (idx >= 0) {
      localModels.value = [
        ...localModels.value.slice(0, idx),
        modelData,
        ...localModels.value.slice(idx + 1),
      ];
    }
  }

  // 持久化到 store
  await store.update({
    models: JSON.parse(JSON.stringify(localModels.value)),
    defaultModelId: selectedModelId.value,
    // 同步全局字段（兼容旧逻辑）
    provider: modelData.provider,
    baseUrl: modelData.baseUrl || '',
    apiKey: modelData.apiKey || '',
  });
  toast.success(t('settings.ai.saved'));
}

// 删除当前模型（支持全部删除）
async function deleteModel() {
  const idx = localModels.value.findIndex((m) => m.id === selectedModelId.value);
  if (idx < 0) return;
  localModels.value = [
    ...localModels.value.slice(0, idx),
    ...localModels.value.slice(idx + 1),
  ];

  if (localModels.value.length > 0) {
    selectedModelId.value = localModels.value[0].id;
    isNewMode.value = false;
    selectModel(selectedModelId.value);
  } else {
    // 全部删完，进入新建模式，表单为空
    selectedModelId.value = '';
    createNewModel();
  }

  await store.update({
    models: JSON.parse(JSON.stringify(localModels.value)),
    defaultModelId: selectedModelId.value,
  });
}

// 初始化：加载第一个模型
if (localModels.value.length > 0) {
  selectModel(selectedModelId.value);
} else {
  createNewModel();
}

// ========== 通用配置 ==========

// 兼容旧版布尔值：true → 'auto', false → 'off'
function resolveAutoSend(val: unknown): 'auto' | 'manual' | 'off' {
  if (val === true) return 'auto';
  if (val === false) return 'off';
  if (val === 'auto' || val === 'manual' || val === 'off') return val;
  return 'auto';
}

// 兼容旧版翻译布尔字段 → 新的 translateMode
function resolveTranslateMode(settings: any): 'selection' | 'auto' | 'click' | 'off' {
  if (settings.translateMode === 'selection' || settings.translateMode === 'auto' || settings.translateMode === 'click' || settings.translateMode === 'off') {
    return settings.translateMode;
  }
  if (settings.selectionTranslate) return 'selection';
  if (settings.autoTranslate) return 'auto';
  if (settings.clickTranslate) return 'click';
  return 'off';
}

const generalForm = reactive({
  theme: store.settings.theme || 'classic',
  shortcut: store.settings.shortcut || '',
  automationEnabled: store.settings.automationEnabled !== false,
  autoSendSelection: resolveAutoSend(store.settings.autoSendSelection),
  translateTargetLang: store.settings.translateTargetLang || '中文',
  translateMode: resolveTranslateMode(store.settings),
  noteMode: (store.settings.noteMode || 'off') as NoteMode,
  maxContext: store.settings.maxContext || 100,
});

const autoSendOptions = computed(() => [
  { value: 'auto' as const, label: t('settings.general.autoSendOptions.auto.label'), desc: t('settings.general.autoSendOptions.auto.desc') },
  { value: 'manual' as const, label: t('settings.general.autoSendOptions.manual.label'), desc: t('settings.general.autoSendOptions.manual.desc') },
  { value: 'off' as const, label: t('settings.general.autoSendOptions.off.label'), desc: t('settings.general.autoSendOptions.off.desc') },
]);

const translateModeOptions = computed(() => [
  { value: 'selection' as const, label: t('settings.general.translateModes.selection.label'), desc: t('settings.general.translateModes.selection.desc') },
  { value: 'click' as const, label: t('settings.general.translateModes.click.label'), desc: t('settings.general.translateModes.click.desc') },
  { value: 'auto' as const, label: t('settings.general.translateModes.auto.label'), desc: t('settings.general.translateModes.auto.desc') },
  { value: 'off' as const, label: t('settings.general.translateModes.off.label'), desc: t('settings.general.translateModes.off.desc') },
]);

const noteModeOptions = computed(() => [
  { value: 'selection' as const, label: t('settings.general.noteModes.selection.label'), desc: t('settings.general.noteModes.selection.desc') },
  { value: 'click' as const, label: t('settings.general.noteModes.click.label'), desc: t('settings.general.noteModes.click.desc') },
  { value: 'auto' as const, label: t('settings.general.noteModes.auto.label'), desc: t('settings.general.noteModes.auto.desc') },
  { value: 'off' as const, label: t('settings.general.noteModes.off.label'), desc: t('settings.general.noteModes.off.desc') },
]);

const translateLangOptions = [
  { value: '中文', label: '中文' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: '日本語' },
  { value: '한국어', label: '한국어' },
  { value: 'Français', label: 'Français' },
  { value: 'Deutsch', label: 'Deutsch' },
  { value: 'Español', label: 'Español' },
  { value: 'Русский', label: 'Русский' },
];

// 快捷键录制
const recording = ref(false);
const shortcutInputRef = ref<HTMLDivElement>();
function startRecord() {
  recording.value = true;
  nextTick(() => shortcutInputRef.value?.focus());
}
function onShortcutKeydown(e: KeyboardEvent) {
  if (!recording.value) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    recording.value = false;
    return;
  }
  const sc = eventToShortcut(e);
  if (sc) {
    generalForm.shortcut = sc;
    recording.value = false;
  }
}
function clearShortcut() {
  generalForm.shortcut = '';
}

// 网页自动化开关切换（切换方向都需确认）
function toggleAutomation() {
  pendingAutomationValue.value = !generalForm.automationEnabled;
  showAutomationConfirm.value = true;
}

// 确认切换自动化
async function confirmToggleAutomation() {
  showAutomationConfirm.value = false;
  generalForm.automationEnabled = pendingAutomationValue.value;
  await saveAndClearHistory();
}

// 取消切换
function cancelToggleAutomation() {
  showAutomationConfirm.value = false;
}

// 保存通用配置
async function saveGeneral() {
  await store.update({
    theme: generalForm.theme,
    shortcut: generalForm.shortcut,
    automationEnabled: generalForm.automationEnabled,
    autoSendSelection: generalForm.autoSendSelection,
    translateTargetLang: generalForm.translateTargetLang,
    translateMode: generalForm.translateMode,
    noteMode: generalForm.noteMode,
  });
  toast.success(t('settings.general.saved'));
  emit('close');
}

// 保存配置 + 清空会话（自动化开关切换时调用）
async function saveAndClearHistory() {
  await store.update({
    theme: generalForm.theme,
    shortcut: generalForm.shortcut,
    automationEnabled: generalForm.automationEnabled,
    autoSendSelection: generalForm.autoSendSelection,
    translateTargetLang: generalForm.translateTargetLang,
    translateMode: generalForm.translateMode,
    noteMode: generalForm.noteMode,
  });
  const convStore = useConversationsStore();
  await convStore.resetConversation();
  toast.success(t('settings.general.saved'));
  emit('close');
}

// 保存上下文消息数
async function saveMaxContext() {
  await store.update({ maxContext: generalForm.maxContext });
  toast.success(t('settings.user.maxContextSaved'));
}

// 导出模型配置为 JSON 文件
function exportModels() {
  const config = localModels.value.map(({ id, ...rest }) => ({
    label: rest.label,
    provider: rest.provider,
    modelName: rest.modelName,
    baseUrl: rest.baseUrl || '',
    apiKey: rest.apiKey || '',
    authField: rest.authField || 'bearer',
    website: rest.website || '',
    reasoning: rest.reasoning,
    vision: rest.vision,
  }));
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-browser-models-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`已导出 ${config.length} 个模型配置`);
}

// 导入模型配置（隐藏 input 触发）
const fileInputRef = ref<HTMLInputElement>();
function triggerImport() {
  fileInputRef.value?.click();
}

function importModels(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  // 重置 input 以便重复选择同一文件
  (e.target as HTMLInputElement).value = '';

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string);
      if (!Array.isArray(data)) {
        toast.error(t('settings.ai.importError'));
        return;
      }

      const validProviders = new Set([
        'openai', 'anthropic', 'gemini', 'custom',
        'qwen', 'wenxin', 'zhipu', 'deepseek',
        'moonshot', 'doubao', 'grok',
      ]);

      let imported = 0;
      let skipped = 0;
      const newModels: ModelConfig[] = [];

      for (const item of data) {
        if (!item || typeof item !== 'object') { skipped++; continue; }
        if (!item.modelName || !validProviders.has(item.provider)) { skipped++; continue; }

        newModels.push({
          id: uuid(),
          label: item.label || item.modelName,
          provider: item.provider,
          modelName: item.modelName,
          baseUrl: item.baseUrl || '',
          apiKey: item.apiKey || '',
          authField: item.authField || 'bearer',
          website: item.website || '',
          reasoning: item.reasoning,
          vision: item.vision,
        });
        imported++;
      }

      if (imported === 0) {
        toast.error(t('settings.ai.importNoValid'));
        return;
      }

      localModels.value = [...localModels.value, ...newModels];
      selectedModelId.value = newModels[0].id;
      isNewMode.value = false;
      selectModel(selectedModelId.value);

      // 持久化
      store.update({
        models: JSON.parse(JSON.stringify(localModels.value)),
        defaultModelId: selectedModelId.value,
      });

      if (skipped > 0) {
        toast.warning(`已导入 ${imported} 个，跳过 ${skipped} 个无效项`);
      } else {
        toast.success(`已导入 ${imported} 个模型配置`);
      }
    } catch {
      toast.error(t('settings.ai.importError'));
    }
  };
  reader.readAsText(file);
}
</script>

<template>
  <div v-show="!showDocs" class="aib-modal-mask">
    <div class="aib-modal aib-modal-settings">
      <div class="aib-modal-header">
        <span>{{ t('settings.title') }}</span>
        <button class="aib-modal-close aib-modal-close-inline" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="aib-settings-body">
        <aside class="aib-settings-tabs">
          <button
            :class="['aib-settings-tab', { 'aib-tab-active': tab === 'ai' }]"
            @click="tab = 'ai'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3H5a3 3 0 0 0 0 6h1a3 3 0 0 0 3 3v1a3 3 0 0 0 6 0v-1a3 3 0 0 0 3-3h1a3 3 0 0 0 0-6h-1a3 3 0 0 0-3-3V5a3 3 0 0 0-3-3z"/>
            </svg>
            {{ t('settings.tabs.ai') }}
          </button>
          <button
            :class="['aib-settings-tab', { 'aib-tab-active': tab === 'general' }]"
            @click="tab = 'general'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {{ t('settings.tabs.general') }}
          </button>
          <button
            :class="['aib-settings-tab', { 'aib-tab-active': tab === 'voice' }]"
            @click="tab = 'voice'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            {{ t('settings.tabs.voice') }}
          </button>
          <button
            :class="['aib-settings-tab', { 'aib-tab-active': tab === 'user' }]"
            @click="tab = 'user'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            {{ t('settings.tabs.user') }}
          </button>
        </aside>

        <div class="aib-settings-pane">
          <!-- ========== 模型配置 ========== -->
          <div v-show="tab === 'ai'" class="aib-modal-body">
            <!-- 标题 -->
            <div class="aib-section-title">{{ t('settings.ai.title') }}</div>

            <!-- 默认模型选择（按钮式） -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.defaultModel') }}</label>
              <div class="aib-model-chips">
                <button
                  v-for="m in localModels"
                  :key="m.id"
                  :class="['aib-chip', { 'aib-chip-active': selectedModelId === m.id }]"
                  @click="selectModel(m.id)"
                >
                  {{ m.label || m.modelName || t('settings.ai.unnamed') }}
                </button>
                <button class="aib-chip aib-chip-new" @click="createNewModel">
                  {{ t('settings.ai.newModel') }}
                </button>
                <button class="aib-chip aib-chip-tool" @click="exportModels" title="导出配置">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {{ t('settings.ai.export') }}
                </button>
                <button class="aib-chip aib-chip-tool" @click="triggerImport" title="导入配置">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  {{ t('settings.ai.import') }}
                </button>
                <input
                  ref="fileInputRef"
                  type="file"
                  accept=".json"
                  style="display:none"
                  @change="importModels"
                />
              </div>
            </div>

            <!-- 快速填充 -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.quickFill') }}</label>
              <div class="aib-preset-grid">
                <button
                  v-for="(preset, key) in providerPresets"
                  :key="key"
                  class="aib-preset-btn"
                  @click="applyPreset(key as string)"
                >
                  {{ preset.name }}
                </button>
              </div>
            </div>

            <!-- 供应商 -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.provider') }}</label>
              <select v-model="form.provider" class="aib-select">
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="qwen">{{ t('settings.ai.providers.qwen') }}</option>
                <option value="wenxin">{{ t('settings.ai.providers.wenxin') }}</option>
                <option value="doubao">{{ t('settings.ai.providers.doubao') }}</option>
                <option value="zhipu">{{ t('settings.ai.providers.zhipu') }}</option>
                <option value="deepseek">DeepSeek</option>
                <option value="moonshot">Moonshot (Kimi)</option>
                <option value="grok">Grok (xAI)</option>
                <option value="custom">{{ t('settings.ai.providers.custom') }}</option>
              </select>
            </div>

            <!-- 显示名称 -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.displayName') }}</label>
              <input
                v-model="form.label"
                class="aib-input"
                :placeholder="t('settings.ai.displayNamePlaceholder')"
              />
            </div>

            <!-- 请求地址 -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.requestUrl') }}</label>
              <input
                v-model="form.baseUrl"
                class="aib-input"
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <!-- API Key -->
            <div class="aib-form-row">
              <label>API Key</label>
              <div class="aib-input-group">
                <input
                  v-model="form.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  class="aib-input aib-input-with-btn"
                  placeholder="sk-..."
                />
                <button
                  class="aib-btn aib-btn-toggle"
                  @click="showApiKey = !showApiKey"
                  :title="showApiKey ? t('common.close') : t('common.confirm')"
                >
                  <svg v-if="!showApiKey" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- 认证字段 -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.authField') }}</label>
              <select v-model="form.authField" class="aib-select">
                <option v-for="a in authFields" :key="a.value" :value="a.value">
                  {{ a.label }}
                </option>
              </select>
            </div>

            <!-- 主模型 -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.modelName') }}</label>
              <input
                v-model="form.modelName"
                class="aib-input"
                :placeholder="t('settings.ai.modelNamePlaceholder')"
              />
            </div>

            <!-- 官网地址 -->
            <div class="aib-form-row">
              <label>{{ t('settings.ai.website') }}</label>
              <input
                v-model="form.website"
                class="aib-input"
                :placeholder="t('settings.ai.websitePlaceholder')"
              />
            </div>

            <!-- 保存/删除按钮 -->
            <div class="aib-tab-footer">
              <button
                v-if="!isNewMode"
                class="aib-btn aib-btn-danger"
                @click="deleteModel"
              >
                {{ t('settings.ai.delete') }}
              </button>
              <div style="flex:1" />
              <button class="aib-btn" @click="emit('close')">{{ t('settings.ai.cancel') }}</button>
              <button class="aib-btn aib-btn-primary" @click="saveModel">
                {{ t('settings.ai.save') }}
              </button>
            </div>
          </div>

          <!-- ========== 通用配置 ========== -->
          <div v-show="tab === 'general'" class="aib-modal-body">
            <div class="aib-form-row">
              <label>{{ t('settings.general.theme') }}</label>
              <div class="aib-theme-grid">
                <div
                  v-for="t in THEMES"
                  :key="t.id"
                  :class="['aib-theme-card', { 'aib-theme-active': generalForm.theme === t.id }]"
                  @click="generalForm.theme = t.id"
                >
                  <div class="aib-theme-preview" :style="{ background: t.dark ? t.vars['--aib-bg'] : t.vars['--aib-bg'] }">
                    <div class="aib-theme-dot" :style="{ background: t.accent }" />
                    <div class="aib-theme-line" :style="{ background: t.vars['--aib-border'] }" />
                    <div class="aib-theme-line aib-theme-line-short" :style="{ background: t.vars['--aib-border'] }" />
                  </div>
                  <div class="aib-theme-name">
                    <span class="aib-theme-swatch" :style="{ background: t.accent }" />
                    {{ t.name }}
                  </div>
                </div>
              </div>
            </div>

            <div class="aib-form-row">
              <label>{{ t('settings.general.shortcut') }}</label>
              <div class="aib-shortcut-row">
                <div
                  ref="shortcutInputRef"
                  :class="['aib-shortcut-input', { 'aib-shortcut-recording': recording }]"
                  tabindex="0"
                  @click="startRecord"
                  @keydown="onShortcutKeydown"
                  @blur="recording = false"
                >
                  <span v-if="recording" class="aib-text-faint">{{ t('settings.general.shortcutRecording') }}</span>
                  <span v-else-if="generalForm.shortcut" class="aib-shortcut-keys">
                    <kbd v-for="(k, i) in generalForm.shortcut.split('+')" :key="i" class="aib-kbd">{{ k }}</kbd>
                  </span>
                  <span v-else class="aib-text-faint">{{ t('settings.general.shortcutRecord') }}</span>
                </div>
                <button class="aib-btn" @click="clearShortcut">{{ t('settings.general.shortcutClear') }}</button>
              </div>
              <div class="aib-text-faint" style="font-size: 12px;">
                {{ t('settings.general.shortcutHint') }}
              </div>
            </div>

            <div class="aib-form-row">
              <label>{{ t('settings.general.automation') }}</label>
              <div class="aib-switch-row">
                <button
                  :class="['aib-switch', { 'aib-switch-on': generalForm.automationEnabled }]"
                  @click="toggleAutomation"
                >
                  <span class="aib-switch-thumb" />
                </button>
                <span class="aib-text-faint" style="font-size: 13px;">
                  {{ generalForm.automationEnabled ? t('settings.general.automationOn') : t('settings.general.automationOff') }}
                </span>
              </div>
              <div class="aib-text-faint" style="font-size: 12px;">
                {{ t('settings.general.automationHint') }}
              </div>
            </div>

            <div class="aib-form-row">
              <label>{{ t('settings.general.autoSend') }}</label>
              <div class="aib-radio-group">
                <div
                  v-for="opt in autoSendOptions"
                  :key="opt.value"
                  :class="['aib-radio-card', { 'aib-radio-active': generalForm.autoSendSelection === opt.value }]"
                  @click="generalForm.autoSendSelection = opt.value"
                >
                  <div class="aib-radio-dot">
                    <span v-if="generalForm.autoSendSelection === opt.value" class="aib-radio-dot-fill" />
                  </div>
                  <div class="aib-radio-body">
                    <span class="aib-radio-label">{{ opt.label }}</span>
                    <span class="aib-radio-desc">{{ opt.desc }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 翻译配置 -->
            <div class="aib-form-row">
              <label>{{ t('settings.general.translate') }}</label>
              <div class="aib-translate-section">
                <div class="aib-form-row-inner">
                  <span class="aib-translate-label">{{ t('settings.general.translateTargetLang') }}</span>
                  <select v-model="generalForm.translateTargetLang" class="aib-select aib-select-sm">
                    <option v-for="lang in translateLangOptions" :key="lang.value" :value="lang.value">
                      {{ lang.label }}
                    </option>
                  </select>
                </div>
                <div class="aib-radio-group">
                  <div
                    v-for="opt in translateModeOptions"
                    :key="opt.value"
                    :class="['aib-radio-card', { 'aib-radio-active': generalForm.translateMode === opt.value }]"
                    @click="generalForm.translateMode = opt.value"
                  >
                    <div class="aib-radio-dot">
                      <span v-if="generalForm.translateMode === opt.value" class="aib-radio-dot-fill" />
                    </div>
                    <div class="aib-radio-body">
                      <span class="aib-radio-label">{{ opt.label }}</span>
                      <span class="aib-radio-desc">{{ opt.desc }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 笔记配置 -->
            <div class="aib-form-row">
              <label>{{ t('settings.general.note') }}</label>
              <div class="aib-translate-section">
                <div class="aib-radio-group">
                  <div
                    v-for="opt in noteModeOptions"
                    :key="opt.value"
                    :class="['aib-radio-card', { 'aib-radio-active': generalForm.noteMode === opt.value }]"
                    @click="generalForm.noteMode = opt.value"
                  >
                    <div class="aib-radio-dot">
                      <span v-if="generalForm.noteMode === opt.value" class="aib-radio-dot-fill" />
                    </div>
                    <div class="aib-radio-body">
                      <span class="aib-radio-label">{{ opt.label }}</span>
                      <span class="aib-radio-desc">{{ opt.desc }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="aib-tab-footer">
              <div style="flex:1" />
              <button class="aib-btn" @click="emit('close')">{{ t('settings.general.cancel') }}</button>
              <button class="aib-btn aib-btn-primary" @click="saveGeneral">{{ t('settings.general.save') }}</button>
            </div>
          </div>

          <!-- ========== 用户配置 ========== -->
          <div v-show="tab === 'user'" class="aib-modal-body">
            <div class="aib-form-row">
              <label>{{ t('settings.user.license') }}</label>
              <div class="aib-input-group">
                <input
                  v-model="licenseKey"
                  class="aib-input aib-input-with-btn"
                  :placeholder="t('settings.user.licensePlaceholder')"
                />
                <button class="aib-btn-activate" @click="activateLicense">
                  {{ t('settings.user.activate') }}
                </button>
              </div>
            </div>

            <!-- 上下文消息数 -->
            <div class="aib-form-row">
              <label>{{ t('settings.user.maxContext') }}</label>
              <div class="aib-input-group">
                <input
                  v-model.number="generalForm.maxContext"
                  type="number"
                  min="100"
                  max="500"
                  step="1"
                  class="aib-input aib-input-with-btn"
                  placeholder="100"
                  @change="generalForm.maxContext = Math.max(100, Math.min(500, Math.round(generalForm.maxContext || 100)))"
                />
                <button class="aib-btn-activate" @click="saveMaxContext">{{ t('settings.general.save') }}</button>
              </div>
              <span class="aib-text-faint">{{ t('settings.user.maxContextHint') }}</span>
            </div>

            <!-- 缓存管理 -->
            <div class="aib-form-row">
              <label>{{ t('settings.user.cache') }}</label>
              <div class="aib-cache-actions">
                <button class="aib-btn aib-btn-icon aib-btn-danger" @click="handleClearCache">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  {{ t('settings.user.clearCache') }}
                </button>
                <div class="aib-cache-info">
                  <div class="aib-cache-size">
                    <span>{{ cacheSizeText }} / 30MB</span>
                    <div class="aib-cache-bar">
                      <div class="aib-cache-bar-fill" :class="cacheBarClass" :style="{ width: cachePercent + '%' }" />
                    </div>
                  </div>
                  <span class="aib-text-faint">{{ t('settings.user.cacheHint') }}</span>
                </div>
              </div>
            </div>

            <!-- 日志管理（仅测试包可见） -->
            <template v-if="logEnabled">
              <div class="aib-form-row">
                <label>{{ t('settings.user.log') }}</label>
                <div class="aib-cache-actions">
                  <button class="aib-btn aib-btn-icon" @click="handleDownloadLogs">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    {{ t('settings.user.downloadLog') }}
                  </button>
                </div>
              </div>
            </template>

            <!-- 语言设置 -->
            <div class="aib-form-row">
              <label>{{ t('settings.user.language') }}</label>
              <div class="aib-radio-group">
                <div
                  :class="['aib-radio-card', { 'aib-radio-active': locale === 'zh-CN' }]"
                  @click="setLocale('zh-CN'); store.update({ locale: 'zh-CN' })"
                >
                  <div class="aib-radio-dot">
                    <span v-if="locale === 'zh-CN'" class="aib-radio-dot-fill" />
                  </div>
                  <div class="aib-radio-body">
                    <span class="aib-radio-label">{{ t('settings.user.langZh') }}</span>
                  </div>
                </div>
                <div
                  :class="['aib-radio-card', { 'aib-radio-active': locale === 'en-US' }]"
                  @click="setLocale('en-US'); store.update({ locale: 'en-US' })"
                >
                  <div class="aib-radio-dot">
                    <span v-if="locale === 'en-US'" class="aib-radio-dot-fill" />
                  </div>
                  <div class="aib-radio-body">
                    <span class="aib-radio-label">{{ t('settings.user.langEn') }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 使用文档 -->
            <div class="aib-form-row">
              <label>{{ t('settings.user.docs') }}</label>
              <button class="aib-docs-link" @click="openDocs">
                {{ t('settings.user.docsHint') }}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
            </div>

            <!-- 版本号 -->
            <div class="aib-version-footer">
              v{{ appVersion }}
            </div>
          </div>

          <!-- ========== 语音设置 ========== -->
          <div v-show="tab === 'voice'" class="aib-modal-body">
            <div class="aib-section-title">{{ t('settings.voice.title') }}</div>

            <!-- 🎤 语音识别 -->
            <div class="aib-form-row">
              <label>{{ t('settings.voice.recognition') }}</label>
            </div>

            <div class="aib-form-row">
              <label>{{ t('settings.voice.engineType') }}</label>
              <div class="aib-select-group">
                <button
                  :class="['aib-select-btn', { active: voiceStore.settings.engineType === 'web-speech' }]"
                  @click="voiceStore.updateSetting('engineType', 'web-speech')"
                >
                  {{ t('settings.voice.engineWebSpeech') }}
                </button>
                <button
                  :class="['aib-select-btn', { active: voiceStore.settings.engineType === 'iflytek' }]"
                  @click="voiceStore.updateSetting('engineType', 'iflytek')"
                >
                  {{ t('settings.voice.engineIflytek') }}
                </button>
              </div>
            </div>

            <div v-if="voiceStore.settings.engineType === 'iflytek'" class="aib-form-row">
              <label>{{ t('settings.voice.iflytekAppId') }}</label>
              <input
                :value="voiceStore.settings.iflytekAppId"
                @input="voiceStore.updateSetting('iflytekAppId', ($event.target as HTMLInputElement).value)"
                placeholder="xxxxxxxx"
                class="aib-input"
              />
            </div>

            <div v-if="voiceStore.settings.engineType === 'iflytek'" class="aib-form-row">
              <label>{{ t('settings.voice.iflytekApiKey') }}</label>
              <input
                :value="voiceStore.settings.iflytekApiKey"
                @input="voiceStore.updateSetting('iflytekApiKey', ($event.target as HTMLInputElement).value)"
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                class="aib-input"
              />
            </div>

            <div class="aib-form-row">
              <label>{{ t('settings.voice.recognitionLang') }}</label>
              <div class="aib-select-group">
                <button
                  :class="['aib-select-btn', { active: voiceStore.settings.recognitionLang === 'zh-CN' }]"
                  @click="voiceStore.updateSetting('recognitionLang', 'zh-CN')"
                >
                  {{ t('settings.voice.langZhCN') }}
                </button>
                <button
                  :class="['aib-select-btn', { active: voiceStore.settings.recognitionLang === 'en-US' }]"
                  @click="voiceStore.updateSetting('recognitionLang', 'en-US')"
                >
                  {{ t('settings.voice.langEnUS') }}
                </button>
              </div>
            </div>

            <!-- 🔔 唤醒词 -->
            <div class="aib-form-row" style="margin-top:16px">
              <label>{{ t('settings.voice.wakeWordLabel') }}</label>
              <input
                :value="voiceStore.settings.wakeWord"
                @input="voiceStore.updateSetting('wakeWord', ($event.target as HTMLInputElement).value)"
                :placeholder="t('settings.voice.wakeWordPlaceholder')"
                class="aib-input"
              />
            </div>

            <!-- 🔊 语音播报 -->
            <div class="aib-form-row" style="margin-top:16px">
              <label>{{ t('settings.voice.enableTts') }}</label>
              <label class="aib-switch">
                <input
                  type="checkbox"
                  :checked="voiceStore.settings.enableTts"
                  @change="voiceStore.updateSetting('enableTts', ($event.target as HTMLInputElement).checked)"
                />
                <span class="aib-switch-slider" />
              </label>
            </div>

            <div v-if="voiceStore.settings.enableTts" class="aib-form-row">
              <label>{{ t('settings.voice.ttsRate') }}: {{ voiceStore.settings.ttsRate.toFixed(1) }}x</label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                :value="voiceStore.settings.ttsRate"
                @input="voiceStore.updateSetting('ttsRate', parseFloat(($event.target as HTMLInputElement).value))"
                class="aib-range"
              />
            </div>

            <div v-if="voiceStore.settings.enableTts" class="aib-form-row">
              <label>{{ t('settings.voice.ttsVolume') }}: {{ Math.round(voiceStore.settings.ttsVolume * 100) }}%</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="voiceStore.settings.ttsVolume"
                @input="voiceStore.updateSetting('ttsVolume', parseFloat(($event.target as HTMLInputElement).value))"
                class="aib-range"
              />
            </div>

            <!-- ⚡ 行为 -->
            <div class="aib-form-row" style="margin-top:16px">
              <label>{{ t('settings.voice.behavior') }}</label>
            </div>

            <div class="aib-form-row">
              <label>{{ t('settings.voice.bufferTimeout') }}: {{ (voiceStore.settings.bufferTimeout / 1000).toFixed(1) }}s</label>
              <span class="aib-form-hint">{{ t('settings.voice.bufferTimeoutHint') }}</span>
              <input
                type="range"
                min="500"
                max="5000"
                step="500"
                :value="voiceStore.settings.bufferTimeout"
                @input="voiceStore.updateSetting('bufferTimeout', parseInt(($event.target as HTMLInputElement).value))"
                class="aib-range"
              />
            </div>

            <div class="aib-form-row">
              <label>{{ t('settings.voice.idleTimeout') }}: {{ (voiceStore.settings.idleTimeout / 1000).toFixed(0) }}s</label>
              <span class="aib-form-hint">{{ t('settings.voice.idleTimeoutHint') }}</span>
              <input
                type="range"
                min="2000"
                max="15000"
                step="1000"
                :value="voiceStore.settings.idleTimeout"
                @input="voiceStore.updateSetting('idleTimeout', parseInt(($event.target as HTMLInputElement).value))"
                class="aib-range"
              />
            </div>

            <div class="aib-tab-footer">
              <div style="flex:1" />
              <button class="aib-btn" @click="emit('close')">{{ t('settings.general.cancel') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 使用文档查看器（替代设置弹框） -->
  <div v-if="showDocs" class="aib-modal-mask" @click.self="closeDocs">
    <div class="aib-modal aib-docs-modal">
      <div class="aib-modal-header">
        <button class="aib-back-btn" @click="closeDocs">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {{ t('common.close') }}
        </button>
        <span>{{ t('settings.user.docs') }}</span>
        <button class="aib-modal-close aib-modal-close-inline" @click="closeDocs">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="aib-docs-body">
        <div class="aib-docs-content" v-html="docsHtml" />
      </div>
    </div>
  </div>

  <!-- 清除缓存确认弹窗 -->
  <ConfirmDialog
    :visible="showClearCacheConfirm"
    :title="t('settings.user.clearCacheConfirm.title')"
    :desc="t('settings.user.clearCacheConfirm.desc')"
    :confirm-text="t('settings.user.clearCacheConfirm.confirm')"
    variant="danger"
    @confirm="confirmClearCache"
    @cancel="showClearCacheConfirm = false"
  >
    <template #icon>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    </template>
  </ConfirmDialog>

  <!-- 切换自动化确认弹窗 -->
  <ConfirmDialog
    :visible="showAutomationConfirm"
    :title="pendingAutomationValue ? t('settings.general.automationOnTitle') : t('settings.general.automationOffTitle')"
    :desc="pendingAutomationValue
      ? t('settings.general.automationOnDesc')
      : t('settings.general.automationOffDesc')"
    :confirm-text="t('settings.general.automationConfirm')"
    variant="primary"
    @confirm="confirmToggleAutomation"
    @cancel="cancelToggleAutomation"
  >
    <template #icon>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
/* 区块标题 */
.aib-section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--aib-text);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--aib-border);
  margin-bottom: 4px;
}

/* 模型选择（按钮式） */
.aib-model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.aib-chip {
  padding: 6px 14px;
  border: 1px solid var(--aib-border-strong);
  border-radius: 8px;
  background: var(--aib-bg-card);
  cursor: pointer;
  font-size: 13px;
  color: var(--aib-text);
  transition: all 0.15s ease;
  font-family: inherit;
}

.aib-chip:hover {
  border-color: var(--aib-primary);
  color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

.aib-chip-active {
  background: var(--aib-primary);
  border-color: var(--aib-primary);
  color: #fff;
  font-weight: 500;
}

.aib-chip-active:hover {
  background: var(--aib-primary);
  color: #fff;
}

.aib-chip-new {
  border-style: dashed;
  color: var(--aib-text-soft);
}

.aib-chip-new:hover {
  border-color: var(--aib-primary);
  color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

.aib-chip-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-style: dashed;
  color: var(--aib-text-soft);
}

.aib-chip-tool:hover {
  border-color: var(--aib-primary);
  color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

/* 输入框 + 按钮组合 */
.aib-input-group {
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
}

.aib-input-with-btn {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  flex: 1;
}

.aib-btn-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 36px;
  border: 1px solid var(--aib-border);
  border-left: none;
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
  background: var(--aib-bg-card);
  cursor: pointer;
  color: var(--aib-text-soft);
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.aib-btn-toggle:hover {
  background: var(--aib-bg-hover);
  color: var(--aib-text);
}

/* 激活按钮 — 与 chip/preset 统一风格 */
.aib-btn-activate {
  padding: 10px 20px;
  border: 1px solid var(--aib-border-strong);
  border-left: none;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  background: var(--aib-bg-card);
  color: var(--aib-text-soft);
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.aib-btn-activate:hover {
  border-color: var(--aib-primary);
  color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

/* 缓存管理按钮组 */
.aib-cache-actions {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.aib-cache-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aib-cache-size {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--aib-text-soft);
  font-variant-numeric: tabular-nums;
}

.aib-cache-bar {
  flex: 1;
  height: 4px;
  background: var(--aib-border);
  border-radius: 2px;
  overflow: hidden;
  min-width: 60px;
}

.aib-cache-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--aib-primary);
  transition: width 0.3s ease;
}

.aib-cache-bar--warn {
  background: #f59e0b;
}

.aib-cache-bar--danger {
  background: #ef4444;
}

.aib-btn-icon {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--aib-border);
  background: var(--aib-bg-card);
  color: var(--aib-text);
  transition: all 0.15s ease;
  font-family: inherit;
  white-space: nowrap;
}

.aib-btn-icon:hover {
  border-color: var(--aib-primary);
  color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

.aib-btn-icon.aib-btn-danger {
  color: #ef4444;
  border: 1px solid rgba(239,68,68,0.3);
  background: rgba(239,68,68,0.06);
}

.aib-btn-icon.aib-btn-danger:hover {
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.5);
  color: #dc2626;
}

/* Tab 底部保存按钮 */
.aib-tab-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 16px;
  margin-top: 8px;
  border-top: 1px solid var(--aib-border);
}

.aib-btn-danger {
  color: #ef4444;
  border: 1px solid rgba(239,68,68,0.3);
  background: rgba(239,68,68,0.06);
  padding: 7px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
  font-family: inherit;
}

.aib-btn-danger:hover {
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.5);
  color: #dc2626;
}

.aib-tab-footer .aib-btn {
  padding: 7px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.aib-tab-footer .aib-btn-primary {
  background: var(--aib-primary);
  border: 1px solid var(--aib-primary);
  color: #fff;
  box-shadow: 0 2px 8px var(--aib-primary-glow);
}

.aib-tab-footer .aib-btn-primary:hover {
  background: var(--aib-primary);
  filter: brightness(1.1);
  box-shadow: 0 4px 12px var(--aib-primary-glow);
  transform: translateY(-1px);
}

/* 供应商预设 */
.aib-preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.aib-preset-btn {
  padding: 6px 14px;
  border: 1px solid var(--aib-border-strong);
  border-radius: 8px;
  background: var(--aib-bg-card);
  color: var(--aib-text-soft);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}

.aib-preset-btn:hover {
  border-color: var(--aib-primary);
  color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

/* 主题选择器 */
.aib-theme-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.aib-theme-card {
  border: 2px solid var(--aib-border);
  border-radius: 12px;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s ease;
  background: var(--aib-bg-card);
}

.aib-theme-card:hover {
  border-color: var(--aib-text-soft);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.aib-theme-active {
  border-color: var(--aib-primary) !important;
  box-shadow: 0 0 16px var(--aib-primary-glow);
}

.aib-theme-preview {
  height: 56px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  position: relative;
}

.aib-theme-preview::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--aib-primary);
  opacity: 0;
  transition: opacity 0.2s;
}

.aib-theme-active .aib-theme-preview::after {
  opacity: 1;
}

.aib-theme-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
}

.aib-theme-line {
  height: 3px;
  border-radius: 2px;
  width: 100%;
  opacity: 0.6;
}

.aib-theme-line-short {
  width: 55%;
}

.aib-theme-name {
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--aib-text-soft);
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--aib-border);
}

.aib-theme-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 4px currentColor;
}

/* 开关 */
.aib-switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.aib-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: var(--aib-border-strong, #3a3a4a);
  cursor: pointer;
  transition: background 0.25s ease;
  flex-shrink: 0;
  padding: 0;
}

.aib-switch-on {
  background: var(--aib-primary);
}

.aib-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.aib-switch-on .aib-switch-thumb {
  transform: translateX(18px);
}

/* 卡片式 Radio - 水平小卡片 */
.aib-radio-group {
  display: flex;
  flex-direction: row;
  gap: 8px;
  margin-top: 4px;
}

.aib-radio-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--aib-border);
  border-radius: 10px;
  background: var(--aib-bg-card);
  cursor: pointer;
  transition: all 0.2s ease;
  flex: 1;
  min-width: 0;
}

.aib-radio-card:hover {
  border-color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

.aib-radio-active {
  border-color: var(--aib-primary);
  background: var(--aib-primary-soft);
  box-shadow: 0 0 0 1px var(--aib-primary);
}

.aib-radio-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--aib-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.2s ease;
}

.aib-radio-active .aib-radio-dot {
  border-color: var(--aib-primary);
}

.aib-radio-dot-fill {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--aib-primary);
  animation: radio-fill 0.2s ease;
}

@keyframes radio-fill {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.aib-radio-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.aib-radio-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--aib-text);
  white-space: nowrap;
}

.aib-radio-active .aib-radio-label {
  color: var(--aib-primary);
}

.aib-radio-desc {
  display: none;
}

/* 小屏适配 */
@media (max-width: 640px) {
  .aib-theme-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .aib-theme-preview {
    height: 44px;
    padding: 8px;
  }

  .aib-theme-name {
    padding: 6px 8px;
    font-size: 11px;
  }

  .aib-radio-group {
    flex-direction: column;
    gap: 6px;
  }

  .aib-radio-card {
    padding: 8px 12px;
  }

  .aib-radio-desc {
    display: block;
    font-size: 11px;
  }

  .aib-radio-label {
    font-size: 12px;
  }
}

/* 翻译配置 */
.aib-translate-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}

.aib-form-row-inner {
  display: flex;
  align-items: center;
  gap: 12px;
}

.aib-translate-label {
  font-size: 13px;
  color: var(--aib-text);
  white-space: nowrap;
  min-width: 64px;
}

.aib-select-sm {
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid var(--aib-border);
  background: var(--aib-bg-card);
  color: var(--aib-text);
  cursor: pointer;
  min-width: 120px;
}

.aib-select-sm:focus {
  border-color: var(--aib-primary);
  outline: none;
}

/* 使用文档链接 */
.aib-docs-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--aib-primary);
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
  transition: opacity 0.15s;
}
.aib-docs-link:hover {
  opacity: 0.8;
  text-decoration: underline;
}

/* 文档查看器 */
.aib-docs-modal {
  width: 90vw;
  max-width: 860px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
}
.aib-docs-modal .aib-modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.aib-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--aib-text-soft);
  font-size: 13px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-family: inherit;
  transition: all 0.15s;
}
.aib-back-btn:hover {
  background: var(--aib-bg-hover);
  color: var(--aib-primary);
}
.aib-docs-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}
.aib-docs-loading {
  text-align: center;
  color: var(--aib-text-soft);
  padding: 60px 0;
}
.aib-docs-content {
  font-size: 14px;
  line-height: 1.8;
  color: var(--aib-text);
}
.aib-docs-content h1 { font-size: 22px; margin: 28px 0 14px; font-weight: 700; color: var(--aib-text); }
.aib-docs-content h1:first-child { margin-top: 0; }
.aib-docs-content h2 { font-size: 17px; margin: 24px 0 10px; font-weight: 600; color: var(--aib-text); border-bottom: 1px solid var(--aib-border); padding-bottom: 8px; }
.aib-docs-content h3 { font-size: 15px; margin: 18px 0 8px; font-weight: 600; color: var(--aib-text); }
.aib-docs-content p { margin: 8px 0; }
.aib-docs-content ul, .aib-docs-content ol { padding-left: 24px; margin: 8px 0; }
.aib-docs-content li { margin: 4px 0; }
.aib-docs-content code { background: var(--aib-bg-card); padding: 2px 6px; border-radius: 4px; font-size: 13px; font-family: 'SF Mono', 'Fira Code', monospace; }
.aib-docs-content pre { background: var(--aib-bg-card); padding: 14px 18px; border-radius: 10px; overflow-x: auto; margin: 14px 0; border: 1px solid var(--aib-border); }
.aib-docs-content pre code { background: none; padding: 0; border: none; }
.aib-docs-content table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
.aib-docs-content th, .aib-docs-content td { border: 1px solid var(--aib-border); padding: 10px 14px; text-align: left; }
.aib-docs-content th { background: var(--aib-bg-card); font-weight: 600; }
.aib-docs-content a { color: var(--aib-primary); text-decoration: none; }
.aib-docs-content a:hover { text-decoration: underline; }
.aib-docs-content blockquote { border-left: 3px solid var(--aib-primary); padding: 8px 14px; margin: 14px 0; color: var(--aib-text-soft); background: var(--aib-bg-card); border-radius: 0 8px 8px 0; }
.aib-docs-content hr { border: none; border-top: 1px solid var(--aib-border); margin: 20px 0; }
.aib-docs-content img { max-width: 100%; border-radius: 8px; margin: 10px 0; }

/* 版本号 */
.aib-version-footer {
  padding-top: 16px;
  margin-top: 8px;
  border-top: 1px solid var(--aib-border);
  font-size: 12px;
  color: var(--aib-text-soft);
  text-align: center;
  opacity: 0.7;
}

/* ========== 语音设置 ========== */

.aib-select-group {
  display: flex;
  gap: 8px;
}

.aib-select-btn {
  padding: 6px 16px;
  border: 1px solid var(--aib-border);
  border-radius: 8px;
  background: var(--aib-bg-card);
  color: var(--aib-text-soft);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: all 0.2s;
}

.aib-select-btn:hover {
  border-color: var(--aib-primary);
}

.aib-select-btn.active {
  border-color: var(--aib-primary);
  background: var(--aib-primary-soft);
  color: var(--aib-primary);
}

.aib-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--aib-border);
  border-radius: 8px;
  background: var(--aib-bg-card);
  color: var(--aib-text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.aib-input:focus {
  border-color: var(--aib-primary);
}

.aib-input::placeholder {
  color: var(--aib-text-faint);
}

/* Toggle switch for voice settings */
label.aib-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

label.aib-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.aib-switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--aib-border-strong, #3a3a4a);
  border-radius: 11px;
  transition: background 0.25s;
}

.aib-switch-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: white;
  border-radius: 50%;
  transition: transform 0.25s;
}

label.aib-switch input:checked + .aib-switch-slider {
  background: var(--aib-primary);
}

label.aib-switch input:checked + .aib-switch-slider::before {
  transform: translateX(18px);
}

.aib-range {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--aib-border);
  border-radius: 2px;
  outline: none;
}

.aib-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--aib-primary);
  cursor: pointer;
}

.aib-form-hint {
  font-size: 11px;
  color: var(--aib-text-faint);
  margin-top: 2px;
}
</style>
