<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import { useSettingsStore } from '@/src/stores/settings';
import { useToast } from '@/src/composables/useToast';
import type { ModelConfig, Provider } from '@/src/types';
import { eventToShortcut } from '@/src/utils/shortcut';
import { THEMES } from '@/src/themes';

const emit = defineEmits<{ (e: 'close'): void }>();
const store = useSettingsStore();
const toast = useToast();

const tab = ref<'ai' | 'general'>('ai');

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

// API 格式选项
const apiFormats = [
  { value: 'open-chat', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'message', label: '通用消息格式' },
];

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
  apiFormat: string;
  authField: string;
  website: string;
  models: { label: string; modelName: string }[];
}

const providerPresets: Record<string, ProviderPreset> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'open-chat',
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
    apiFormat: 'anthropic',
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
    apiFormat: 'open-chat',
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
    apiFormat: 'open-chat',
    authField: 'bearer',
    website: 'https://dev.mi.com/',
    models: [
      { label: 'MiMo 7B', modelName: 'MiMo-7B-RL' },
    ],
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    apiFormat: 'open-chat',
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
    apiFormat: 'open-chat',
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
    apiFormat: 'open-chat',
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
    apiFormat: 'message',
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
    apiFormat: 'open-chat',
    authField: 'bearer',
    website: 'https://platform.minimaxi.com/',
    models: [
      { label: 'MiniMax-Text', modelName: 'MiniMax-Text-01' },
    ],
  },
  siliconflow: {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiFormat: 'open-chat',
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
    apiFormat: 'open-chat',
    authField: 'bearer',
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
  form.apiFormat = preset.apiFormat;
  form.authField = preset.authField;
  form.label = preset.name;
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
    apiFormat: form.apiFormat,
    authField: form.authField,
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

const generalForm = reactive({
  theme: store.settings.theme || 'classic',
  shortcut: store.settings.shortcut || '',
});

// 快捷键录制
const recording = ref(false);
function startRecord() {
  recording.value = true;
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
  });
  toast.success('通用配置已保存');
  emit('close');
}

// 导出当前模型配置（可粘贴到 local-config.ts）
const exportNotice = ref(false);
function exportConfig() {
  const config = localModels.value.map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    modelName: m.modelName,
    baseUrl: m.baseUrl || '',
    apiKey: m.apiKey || '',
    apiFormat: m.apiFormat || 'open-chat',
    authField: m.authField || 'bearer',
  }));
  const code = `export const DEFAULT_MODEL_ID = '${selectedModelId.value}';\n\nexport const LOCAL_MODELS = ${JSON.stringify(config, null, 2)};`;
  navigator.clipboard.writeText(code).then(() => {
    exportNotice.value = true;
    setTimeout(() => (exportNotice.value = false), 2000);
  });
}
</script>

<template>
  <div class="zwf-modal-mask">
    <div class="zwf-modal zwf-modal-settings">
      <div class="zwf-modal-header">
        <span>设置</span>
        <button class="zwf-modal-close zwf-modal-close-inline" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="zwf-settings-body">
        <aside class="zwf-settings-tabs">
          <button
            :class="['zwf-settings-tab', { 'zwf-tab-active': tab === 'ai' }]"
            @click="tab = 'ai'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3H5a3 3 0 0 0 0 6h1a3 3 0 0 0 3 3v1a3 3 0 0 0 6 0v-1a3 3 0 0 0 3-3h1a3 3 0 0 0 0-6h-1a3 3 0 0 0-3-3V5a3 3 0 0 0-3-3z"/>
            </svg>
            模型配置
          </button>
          <button
            :class="['zwf-settings-tab', { 'zwf-tab-active': tab === 'general' }]"
            @click="tab = 'general'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            通用配置
          </button>
        </aside>

        <div class="zwf-settings-pane">
          <!-- ========== 模型配置 ========== -->
          <div v-show="tab === 'ai'" class="zwf-modal-body">
            <!-- 标题 -->
            <div class="zwf-section-title">模型配置</div>

            <!-- 默认模型选择（按钮式） -->
            <div class="zwf-form-row">
              <label>默认模型</label>
              <div class="zwf-model-chips">
                <button
                  v-for="m in localModels"
                  :key="m.id"
                  :class="['zwf-chip', { 'zwf-chip-active': selectedModelId === m.id }]"
                  @click="selectModel(m.id)"
                >
                  {{ m.label || m.modelName || '未命名' }}
                </button>
                <button class="zwf-chip zwf-chip-new" @click="createNewModel">
                  + 新建
                </button>
              </div>
            </div>

            <!-- 快速填充 -->
            <div class="zwf-form-row">
              <label>快速填充</label>
              <div class="zwf-preset-grid">
                <button
                  v-for="(preset, key) in providerPresets"
                  :key="key"
                  class="zwf-preset-btn"
                  @click="applyPreset(key as string)"
                >
                  {{ preset.name }}
                </button>
              </div>
            </div>

            <!-- 显示名称 -->
            <div class="zwf-form-row">
              <label>显示名称</label>
              <input
                v-model="form.label"
                class="zwf-input"
                placeholder="如：GPT-4o、DeepSeek Chat"
              />
            </div>

            <!-- 请求地址 -->
            <div class="zwf-form-row">
              <label>请求地址</label>
              <input
                v-model="form.baseUrl"
                class="zwf-input"
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <!-- API Key -->
            <div class="zwf-form-row">
              <label>API Key</label>
              <div class="zwf-input-group">
                <input
                  v-model="form.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  class="zwf-input zwf-input-with-btn"
                  placeholder="sk-..."
                />
                <button
                  class="zwf-btn zwf-btn-toggle"
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

            <!-- API 格式 -->
            <div class="zwf-form-row">
              <label>API 格式</label>
              <select v-model="form.apiFormat" class="zwf-select">
                <option v-for="f in apiFormats" :key="f.value" :value="f.value">
                  {{ f.label }}
                </option>
              </select>
            </div>

            <!-- 认证字段 -->
            <div class="zwf-form-row">
              <label>认证字段</label>
              <select v-model="form.authField" class="zwf-select">
                <option v-for="a in authFields" :key="a.value" :value="a.value">
                  {{ a.label }}
                </option>
              </select>
            </div>

            <!-- 主模型 -->
            <div class="zwf-form-row">
              <label>主模型</label>
              <input
                v-model="form.modelName"
                class="zwf-input"
                placeholder="如：gpt-4o、deepseek-chat、qwen-turbo"
              />
            </div>

            <!-- 保存/删除按钮 -->
            <div class="zwf-tab-footer">
              <button
                v-if="!isNewMode"
                class="zwf-btn zwf-btn-danger"
                @click="deleteModel"
              >
                删除模型
              </button>
              <div style="flex:1" />
              <button class="zwf-btn" @click="emit('close')">取消</button>
              <button class="zwf-btn zwf-btn-primary" @click="saveModel">
                保存
              </button>
            </div>
          </div>

          <!-- ========== 通用配置 ========== -->
          <div v-show="tab === 'general'" class="zwf-modal-body">
            <div class="zwf-form-row">
              <label>主题风格</label>
              <div class="zwf-theme-grid">
                <div
                  v-for="t in THEMES"
                  :key="t.id"
                  :class="['zwf-theme-card', { 'zwf-theme-active': generalForm.theme === t.id }]"
                  @click="generalForm.theme = t.id"
                >
                  <div class="zwf-theme-preview" :style="{ background: t.dark ? t.vars['--zwf-bg'] : t.vars['--zwf-bg'] }">
                    <div class="zwf-theme-dot" :style="{ background: t.accent }" />
                    <div class="zwf-theme-line" :style="{ background: t.vars['--zwf-border'] }" />
                    <div class="zwf-theme-line zwf-theme-line-short" :style="{ background: t.vars['--zwf-border'] }" />
                  </div>
                  <div class="zwf-theme-name">
                    <span class="zwf-theme-swatch" :style="{ background: t.accent }" />
                    {{ t.name }}
                  </div>
                </div>
              </div>
            </div>

            <div class="zwf-form-row">
              <label>快捷键</label>
              <div class="zwf-shortcut-row">
                <div
                  :class="['zwf-shortcut-input', { 'zwf-shortcut-recording': recording }]"
                  tabindex="0"
                  @click="startRecord"
                  @keydown="onShortcutKeydown"
                  @blur="recording = false"
                >
                  <span v-if="recording" class="zwf-text-faint">按下任意组合键，Esc 取消</span>
                  <span v-else-if="generalForm.shortcut" class="zwf-shortcut-keys">
                    <kbd v-for="(k, i) in generalForm.shortcut.split('+')" :key="i" class="zwf-kbd">{{ k }}</kbd>
                  </span>
                  <span v-else class="zwf-text-faint">点击录制快捷键</span>
                </div>
                <button class="zwf-btn" @click="clearShortcut">清除</button>
              </div>
              <div class="zwf-text-faint" style="font-size: 12px;">
                提示：浏览器扩展全局快捷键需在 chrome://extensions/shortcuts 配置；此处设置的是页面内监听的快捷键。
              </div>
            </div>

            <div class="zwf-tab-footer">
              <div style="flex:1" />
              <button class="zwf-btn" @click="emit('close')">取消</button>
              <button class="zwf-btn zwf-btn-primary" @click="saveGeneral">保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 区块标题 */
.zwf-section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--zwf-text);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--zwf-border);
  margin-bottom: 4px;
}

/* 模型选择（按钮式） */
.zwf-model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.zwf-chip {
  padding: 6px 14px;
  border: 1px solid var(--zwf-border-strong);
  border-radius: 8px;
  background: var(--zwf-bg-card);
  cursor: pointer;
  font-size: 13px;
  color: var(--zwf-text);
  transition: all 0.15s ease;
  font-family: inherit;
}

.zwf-chip:hover {
  border-color: var(--zwf-primary);
  color: var(--zwf-primary);
  background: var(--zwf-primary-soft);
}

.zwf-chip-active {
  background: var(--zwf-primary);
  border-color: var(--zwf-primary);
  color: #fff;
  font-weight: 500;
}

.zwf-chip-active:hover {
  background: var(--zwf-primary);
  color: #fff;
}

.zwf-chip-new {
  border-style: dashed;
  color: var(--zwf-text-soft);
}

.zwf-chip-new:hover {
  border-color: var(--zwf-primary);
  color: var(--zwf-primary);
  background: var(--zwf-primary-soft);
}

/* 输入框 + 按钮组合 */
.zwf-input-group {
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
}

.zwf-input-with-btn {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  flex: 1;
}

.zwf-btn-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 36px;
  border: 1px solid var(--zwf-border);
  border-left: none;
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
  background: var(--zwf-bg-card);
  cursor: pointer;
  color: var(--zwf-text-soft);
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.zwf-btn-toggle:hover {
  background: var(--zwf-bg-hover);
  color: var(--zwf-text);
}

/* Tab 底部保存按钮 */
.zwf-tab-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 16px;
  margin-top: 8px;
  border-top: 1px solid var(--zwf-border);
}

.zwf-btn-danger {
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

.zwf-btn-danger:hover {
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.5);
  color: #dc2626;
}

.zwf-tab-footer .zwf-btn {
  padding: 7px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.zwf-tab-footer .zwf-btn-primary {
  background: var(--zwf-primary);
  border: 1px solid var(--zwf-primary);
  color: #fff;
  box-shadow: 0 2px 8px var(--zwf-primary-glow);
}

.zwf-tab-footer .zwf-btn-primary:hover {
  background: var(--zwf-primary);
  filter: brightness(1.1);
  box-shadow: 0 4px 12px var(--zwf-primary-glow);
  transform: translateY(-1px);
}

/* 供应商预设 */
.zwf-preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.zwf-preset-btn {
  padding: 6px 14px;
  border: 1px solid var(--zwf-border-strong);
  border-radius: 8px;
  background: var(--zwf-bg-card);
  color: var(--zwf-text-soft);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}

.zwf-preset-btn:hover {
  border-color: var(--zwf-primary);
  color: var(--zwf-primary);
  background: var(--zwf-primary-soft);
}

/* 主题选择器 */
.zwf-theme-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.zwf-theme-card {
  border: 2px solid var(--zwf-border);
  border-radius: 12px;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s ease;
  background: var(--zwf-bg-card);
}

.zwf-theme-card:hover {
  border-color: var(--zwf-text-soft);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.zwf-theme-active {
  border-color: var(--zwf-primary) !important;
  box-shadow: 0 0 16px var(--zwf-primary-glow);
}

.zwf-theme-preview {
  height: 56px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  position: relative;
}

.zwf-theme-preview::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--zwf-primary);
  opacity: 0;
  transition: opacity 0.2s;
}

.zwf-theme-active .zwf-theme-preview::after {
  opacity: 1;
}

.zwf-theme-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
}

.zwf-theme-line {
  height: 3px;
  border-radius: 2px;
  width: 100%;
  opacity: 0.6;
}

.zwf-theme-line-short {
  width: 55%;
}

.zwf-theme-name {
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--zwf-text-soft);
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--zwf-border);
}

.zwf-theme-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 4px currentColor;
}
</style>
