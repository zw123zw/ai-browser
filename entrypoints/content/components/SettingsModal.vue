<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import { useSettingsStore } from '@/src/stores/settings';
import { useConversationsStore } from '@/src/stores/conversations';
import { useToast } from '@/src/composables/useToast';
import { abortPipeline } from '@/src/composables/usePipeline';
import type { ModelConfig, Provider } from '@/src/types';
import { eventToShortcut } from '@/src/utils/shortcut';
import { THEMES } from '@/src/themes';
import ConfirmDialog from './ConfirmDialog.vue';

const emit = defineEmits<{ (e: 'close'): void }>();
const store = useSettingsStore();
const toast = useToast();

// ========== License & 缓存 ==========
const licenseKey = ref('');
const logEnabled = !!import.meta.env.VITE_LOG_ENABLED;
const showClearCacheConfirm = ref(false);

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
  toast.info('激活功能暂未开放');
}

async function handleClearCache() {
  showClearCacheConfirm.value = true;
}

async function confirmClearCache() {
  showClearCacheConfirm.value = false;
  // 先中断所有进行中的请求
  abortPipeline();
  const convStore = useConversationsStore();
  convStore.abort();
  await convStore.resetConversation();
  const { clearCache } = await import('@/src/utils/cache');
  await clearCache();
  toast.success('缓存已清除');
  await loadCacheSize();
}

onMounted(loadCacheSize);

async function handleDownloadLogs() {
  const { downloadLogs } = await import('@/src/utils/log-storage');
  await downloadLogs();
  toast.success('日志已下载');
}

const tab = ref<'ai' | 'general' | 'user'>('ai');

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
    label: form.label || form.modelName || '未命名模型',
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
  toast.success('模型配置已保存');
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
  autoSendSelection: resolveAutoSend(store.settings.autoSendSelection),
  translateTargetLang: store.settings.translateTargetLang || '中文',
  translateMode: resolveTranslateMode(store.settings),
});

const autoSendOptions = [
  { value: 'auto' as const, label: '自动发送', desc: '选中文字后直接发送给 AI 分析' },
  { value: 'manual' as const, label: '手动发送', desc: '选中文字后填入聊天输入框，手动确认发送' },
  { value: 'off' as const, label: '关闭', desc: '不处理页面选中文字' },
];

const translateModeOptions = [
  { value: 'selection' as const, label: '划词翻译', desc: '选中文字后弹出翻译浮层' },
  { value: 'auto' as const, label: '自动翻译', desc: '页面文本自动翻译为目标语言' },
  { value: 'click' as const, label: '点击翻译', desc: '点击段落翻译整块内容' },
  { value: 'off' as const, label: '关闭', desc: '不启用翻译功能' },
];

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

// 保存通用配置
async function saveGeneral() {
  await store.update({
    theme: generalForm.theme,
    shortcut: generalForm.shortcut,
    autoSendSelection: generalForm.autoSendSelection,
    translateTargetLang: generalForm.translateTargetLang,
    translateMode: generalForm.translateMode,
  });
  toast.success('通用配置已保存');
  emit('close');
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
        toast.error('文件格式错误，期望 JSON 数组');
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
        toast.error('未找到有效模型配置');
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
      toast.error('文件格式错误，请确认是 JSON 数组');
    }
  };
  reader.readAsText(file);
}
</script>

<template>
  <div class="aib-modal-mask">
    <div class="aib-modal aib-modal-settings">
      <div class="aib-modal-header">
        <span>设置</span>
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
            模型配置
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
            通用配置
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
            用户配置
          </button>
        </aside>

        <div class="aib-settings-pane">
          <!-- ========== 模型配置 ========== -->
          <div v-show="tab === 'ai'" class="aib-modal-body">
            <!-- 标题 -->
            <div class="aib-section-title">模型配置</div>

            <!-- 默认模型选择（按钮式） -->
            <div class="aib-form-row">
              <label>默认模型</label>
              <div class="aib-model-chips">
                <button
                  v-for="m in localModels"
                  :key="m.id"
                  :class="['aib-chip', { 'aib-chip-active': selectedModelId === m.id }]"
                  @click="selectModel(m.id)"
                >
                  {{ m.label || m.modelName || '未命名' }}
                </button>
                <button class="aib-chip aib-chip-new" @click="createNewModel">
                  + 新建
                </button>
                <button class="aib-chip aib-chip-tool" @click="exportModels" title="导出配置">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  导出
                </button>
                <button class="aib-chip aib-chip-tool" @click="triggerImport" title="导入配置">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  导入
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
              <label>快速填充</label>
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
              <label>供应商</label>
              <select v-model="form.provider" class="aib-select">
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="qwen">通义千问</option>
                <option value="wenxin">文心一言</option>
                <option value="doubao">豆包</option>
                <option value="zhipu">智谱清言</option>
                <option value="deepseek">DeepSeek</option>
                <option value="moonshot">Moonshot (Kimi)</option>
                <option value="grok">Grok (xAI)</option>
                <option value="custom">自定义</option>
              </select>
            </div>

            <!-- 显示名称 -->
            <div class="aib-form-row">
              <label>显示名称</label>
              <input
                v-model="form.label"
                class="aib-input"
                placeholder="如：GPT-4o、DeepSeek Chat"
              />
            </div>

            <!-- 请求地址 -->
            <div class="aib-form-row">
              <label>请求地址</label>
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
                  :title="showApiKey ? '隐藏' : '显示'"
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
              <label>认证字段</label>
              <select v-model="form.authField" class="aib-select">
                <option v-for="a in authFields" :key="a.value" :value="a.value">
                  {{ a.label }}
                </option>
              </select>
            </div>

            <!-- 主模型 -->
            <div class="aib-form-row">
              <label>主模型</label>
              <input
                v-model="form.modelName"
                class="aib-input"
                placeholder="如：gpt-4o、deepseek-chat、qwen-turbo"
              />
            </div>

            <!-- 官网地址 -->
            <div class="aib-form-row">
              <label>官网地址</label>
              <input
                v-model="form.website"
                class="aib-input"
                placeholder="如：https://platform.openai.com/"
              />
            </div>

            <!-- 保存/删除按钮 -->
            <div class="aib-tab-footer">
              <button
                v-if="!isNewMode"
                class="aib-btn aib-btn-danger"
                @click="deleteModel"
              >
                删除模型
              </button>
              <div style="flex:1" />
              <button class="aib-btn" @click="emit('close')">取消</button>
              <button class="aib-btn aib-btn-primary" @click="saveModel">
                保存
              </button>
            </div>
          </div>

          <!-- ========== 通用配置 ========== -->
          <div v-show="tab === 'general'" class="aib-modal-body">
            <div class="aib-form-row">
              <label>主题风格</label>
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
              <label>快捷键</label>
              <div class="aib-shortcut-row">
                <div
                  ref="shortcutInputRef"
                  :class="['aib-shortcut-input', { 'aib-shortcut-recording': recording }]"
                  tabindex="0"
                  @click="startRecord"
                  @keydown="onShortcutKeydown"
                  @blur="recording = false"
                >
                  <span v-if="recording" class="aib-text-faint">按下任意组合键，Esc 取消</span>
                  <span v-else-if="generalForm.shortcut" class="aib-shortcut-keys">
                    <kbd v-for="(k, i) in generalForm.shortcut.split('+')" :key="i" class="aib-kbd">{{ k }}</kbd>
                  </span>
                  <span v-else class="aib-text-faint">点击录制快捷键</span>
                </div>
                <button class="aib-btn" @click="clearShortcut">清除</button>
              </div>
              <div class="aib-text-faint" style="font-size: 12px;">
                提示：浏览器扩展全局快捷键需在 chrome://extensions/shortcuts 配置；此处设置的是页面内监听的快捷键。
              </div>
            </div>

            <div class="aib-form-row">
              <label>划词操作</label>
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
              <label>翻译配置</label>
              <div class="aib-translate-section">
                <div class="aib-form-row-inner">
                  <span class="aib-translate-label">目标语言</span>
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

            <div class="aib-tab-footer">
              <div style="flex:1" />
              <button class="aib-btn" @click="emit('close')">取消</button>
              <button class="aib-btn aib-btn-primary" @click="saveGeneral">保存</button>
            </div>
          </div>

          <!-- ========== 用户配置 ========== -->
          <div v-show="tab === 'user'" class="aib-modal-body">
            <div class="aib-form-row">
              <label>激活码</label>
              <div class="aib-input-group">
                <input
                  v-model="licenseKey"
                  class="aib-input aib-input-with-btn"
                  placeholder="请输入激活码"
                />
                <button class="aib-btn-activate" @click="activateLicense">
                  激活
                </button>
              </div>
            </div>

            <!-- 缓存管理 -->
            <div class="aib-form-row">
              <label>缓存管理</label>
              <div class="aib-cache-actions">
                <button class="aib-btn aib-btn-icon aib-btn-danger" @click="handleClearCache">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  清除缓存
                </button>
                <div class="aib-cache-info">
                  <div class="aib-cache-size">
                    <span>{{ cacheSizeText }} / 30MB</span>
                    <div class="aib-cache-bar">
                      <div class="aib-cache-bar-fill" :class="cacheBarClass" :style="{ width: cachePercent + '%' }" />
                    </div>
                  </div>
                  <span class="aib-text-faint">清除会话消息、日志、输入历史，用户个性化设置不会丢失</span>
                </div>
              </div>
            </div>

            <!-- 日志管理（仅测试包可见） -->
            <template v-if="logEnabled">
              <div class="aib-form-row">
                <label>日志管理</label>
                <div class="aib-cache-actions">
                  <button class="aib-btn aib-btn-icon" @click="handleDownloadLogs">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    下载日志
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 清除缓存确认弹窗 -->
  <ConfirmDialog
    :visible="showClearCacheConfirm"
    title="清除缓存"
    desc="将清除会话消息、日志和输入历史，用户个性化设置不会丢失。"
    confirm-text="确认清除"
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
</style>
