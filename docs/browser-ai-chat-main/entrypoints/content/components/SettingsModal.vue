<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { v4 as uuid } from 'uuid';
import { useSettingsStore } from '@/src/stores/settings';
import type { ModelConfig, Provider } from '@/src/types';
import { eventToShortcut } from '@/src/utils/shortcut';

const emit = defineEmits<{ (e: 'close'): void }>();
const store = useSettingsStore();

// 表单本地副本（深拷贝，保存时再提交）
const form = reactive(
  JSON.parse(JSON.stringify(store.settings)) as typeof store.settings
);
const triedSubmit = reactive({ value: false });
const tab = ref<'ai' | 'general'>('ai');

const errors = computed(() => {
  const e: Record<string, string> = {};
  // AI 配置
  if (!form.baseUrl?.trim()) e.baseUrl = '请填写请求地址';
  else if (!/^https?:\/\//i.test(form.baseUrl.trim())) e.baseUrl = '需要以 http(s):// 开头';
  if (!form.apiKey?.trim()) e.apiKey = '请填写 API Key';
  if (!form.maxContext || form.maxContext < 1) e.maxContext = '不能小于 1';
  if (!form.maxConversations || form.maxConversations < 1) e.maxConversations = '不能小于 1';
  if (!form.models || !form.models.length) e.models = '至少保留一个模型';
  else {
    form.models.forEach((m: ModelConfig, i: number) => {
      if (!m.label?.trim()) e[`model-${i}-label`] = '显示名不能为空';
      if (!m.modelName?.trim()) e[`model-${i}-modelName`] = '模型 id 不能为空';
    });
  }
  if (!form.defaultModelId || !form.models?.find((m) => m.id === form.defaultModelId)) {
    e.defaultModelId = '请选择默认模型';
  }
  // 通用配置
  if (!form.drawerWidth || form.drawerWidth < 40 || form.drawerWidth > 100) {
    e.drawerWidth = '范围 40 - 100';
  }
  if (!form.primaryColor || !/^#[0-9a-f]{6}$/i.test(form.primaryColor)) {
    e.primaryColor = '请选择有效颜色';
  }
  if (!form.shortcut?.trim()) e.shortcut = '请录制快捷键';
  return e;
});

const aiKeys = ['baseUrl', 'apiKey', 'maxContext', 'maxConversations', 'models', 'defaultModelId'];
const generalKeys = ['drawerWidth', 'primaryColor', 'shortcut'];

const aiInvalid = computed(() =>
  Object.keys(errors.value).some(
    (k) => aiKeys.includes(k) || k.startsWith('model-')
  )
);
const generalInvalid = computed(() =>
  Object.keys(errors.value).some((k) => generalKeys.includes(k))
);
const valid = computed(() => Object.keys(errors.value).length === 0);

function shouldShow(key: string) {
  return triedSubmit.value && errors.value[key];
}

async function save() {
  triedSubmit.value = true;
  if (!valid.value) {
    // 自动切到含错误的 tab
    if (aiInvalid.value) tab.value = 'ai';
    else if (generalInvalid.value) tab.value = 'general';
    return;
  }
  await store.update(JSON.parse(JSON.stringify(form)));
  emit('close');
}

function addModel() {
  const m: ModelConfig = {
    id: uuid(),
    label: '',
    provider: form.provider,
    modelName: '',
  };
  form.models = [...form.models, m];
}

function removeModel(idx: number) {
  const removed = form.models[idx];
  form.models.splice(idx, 1);
  if (removed.id === form.defaultModelId) {
    form.defaultModelId = form.models[0]?.id || '';
  }
}

const providers: { value: Provider; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic（待实现）' },
  { value: 'gemini', label: 'Gemini（待实现）' },
  { value: 'custom', label: '自定义' },
];

// === 快捷键录制 ===
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
    form.shortcut = sc;
    recording.value = false;
  }
}
function clearShortcut() {
  form.shortcut = '';
}

// === 主题色快捷选择 ===
const PRESET_COLORS = ['#4f46e5', '#7c3aed', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#0ea5e9'];
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
            AI 配置
            <span v-if="triedSubmit.value && aiInvalid" class="zwf-tab-dot" />
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
            <span v-if="triedSubmit.value && generalInvalid" class="zwf-tab-dot" />
          </button>
        </aside>

        <div class="zwf-settings-pane">
          <!-- AI 配置 -->
          <div v-show="tab === 'ai'" class="zwf-modal-body">
            <div class="zwf-form-row">
              <label>协议</label>
              <select v-model="form.provider" class="zwf-select">
                <option v-for="p in providers" :key="p.value" :value="p.value">
                  {{ p.label }}
                </option>
              </select>
            </div>

            <div class="zwf-form-row">
              <label>请求地址 (Base URL) <span class="zwf-required">*</span></label>
              <input
                v-model="form.baseUrl"
                class="zwf-input"
                :class="{ 'zwf-input-error': shouldShow('baseUrl') }"
                placeholder="https://api.openai.com/v1"
              />
              <div v-if="shouldShow('baseUrl')" class="zwf-error">{{ errors.baseUrl }}</div>
            </div>

            <div class="zwf-form-row">
              <label>API Key <span class="zwf-required">*</span></label>
              <input
                v-model="form.apiKey"
                type="password"
                class="zwf-input"
                :class="{ 'zwf-input-error': shouldShow('apiKey') }"
                placeholder="sk-..."
              />
              <div v-if="shouldShow('apiKey')" class="zwf-error">{{ errors.apiKey }}</div>
            </div>

            <div class="zwf-form-row">
              <label>最大上下文条数（每次请求 + 本地保留） <span class="zwf-required">*</span></label>
              <input
                v-model.number="form.maxContext"
                type="number"
                min="1"
                class="zwf-input"
                :class="{ 'zwf-input-error': shouldShow('maxContext') }"
              />
              <div v-if="shouldShow('maxContext')" class="zwf-error">{{ errors.maxContext }}</div>
            </div>

            <div class="zwf-form-row">
              <label>最大会话数 <span class="zwf-required">*</span></label>
              <input
                v-model.number="form.maxConversations"
                type="number"
                min="1"
                class="zwf-input"
                :class="{ 'zwf-input-error': shouldShow('maxConversations') }"
              />
              <div v-if="shouldShow('maxConversations')" class="zwf-error">
                {{ errors.maxConversations }}
              </div>
            </div>

            <div class="zwf-form-row">
              <label>默认模型 <span class="zwf-required">*</span></label>
              <select
                v-model="form.defaultModelId"
                class="zwf-select"
                :class="{ 'zwf-input-error': shouldShow('defaultModelId') }"
              >
                <option value="" disabled>请选择</option>
                <option v-for="m in form.models" :key="m.id" :value="m.id">
                  {{ m.label || '(未命名)' }}
                </option>
              </select>
              <div v-if="shouldShow('defaultModelId')" class="zwf-error">
                {{ errors.defaultModelId }}
              </div>
            </div>

            <div class="zwf-form-row">
              <label>模型列表 <span class="zwf-required">*</span></label>
              <div v-for="(m, i) in form.models" :key="m.id" class="zwf-model-row">
                <div style="flex: 1;">
                  <input
                    v-model="m.label"
                    class="zwf-input"
                    :class="{ 'zwf-input-error': shouldShow(`model-${i}-label`) }"
                    placeholder="显示名"
                  />
                  <div v-if="shouldShow(`model-${i}-label`)" class="zwf-error">
                    {{ errors[`model-${i}-label`] }}
                  </div>
                </div>
                <div style="flex: 1.2;">
                  <input
                    v-model="m.modelName"
                    class="zwf-input"
                    :class="{ 'zwf-input-error': shouldShow(`model-${i}-modelName`) }"
                    placeholder="模型 id"
                  />
                  <div v-if="shouldShow(`model-${i}-modelName`)" class="zwf-error">
                    {{ errors[`model-${i}-modelName`] }}
                  </div>
                </div>
                <button class="zwf-icon-btn zwf-icon-btn-danger" title="删除" @click="removeModel(i)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </div>
              <div v-if="shouldShow('models')" class="zwf-error">{{ errors.models }}</div>
              <button class="zwf-btn zwf-btn-add" @click="addModel">+ 新增模型</button>
            </div>
          </div>

          <!-- 通用配置 -->
          <div v-show="tab === 'general'" class="zwf-modal-body">
            <div class="zwf-form-row">
              <label>抽屉宽度 <span class="zwf-text-faint">({{ form.drawerWidth }}%)</span></label>
              <input
                v-model.number="form.drawerWidth"
                type="range"
                min="40"
                max="100"
                step="1"
                class="zwf-range"
              />
              <div v-if="shouldShow('drawerWidth')" class="zwf-error">{{ errors.drawerWidth }}</div>
            </div>

            <div class="zwf-form-row">
              <label>主题色</label>
              <div class="zwf-color-row">
                <input
                  v-model="form.primaryColor"
                  type="color"
                  class="zwf-color-picker"
                />
                <input
                  v-model="form.primaryColor"
                  class="zwf-input"
                  style="flex: 1;"
                  :class="{ 'zwf-input-error': shouldShow('primaryColor') }"
                  placeholder="#4f46e5"
                />
              </div>
              <div class="zwf-color-presets">
                <button
                  v-for="c in PRESET_COLORS"
                  :key="c"
                  class="zwf-color-swatch"
                  :class="{ 'zwf-color-swatch-active': c.toLowerCase() === form.primaryColor.toLowerCase() }"
                  :style="{ background: c }"
                  :title="c"
                  @click="form.primaryColor = c"
                />
              </div>
              <div v-if="shouldShow('primaryColor')" class="zwf-error">{{ errors.primaryColor }}</div>
            </div>

            <div class="zwf-form-row">
              <label>唤起快捷键</label>
              <div class="zwf-shortcut-row">
                <div
                  :class="['zwf-shortcut-input', { 'zwf-shortcut-recording': recording, 'zwf-input-error': shouldShow('shortcut') }]"
                  tabindex="0"
                  @click="startRecord"
                  @keydown="onShortcutKeydown"
                  @blur="recording = false"
                >
                  <span v-if="recording" class="zwf-text-faint">按下任意组合键，Esc 取消</span>
                  <span v-else-if="form.shortcut" class="zwf-shortcut-keys">
                    <kbd v-for="(k, i) in form.shortcut.split('+')" :key="i" class="zwf-kbd">{{ k }}</kbd>
                  </span>
                  <span v-else class="zwf-text-faint">点击录制快捷键</span>
                </div>
                <button class="zwf-btn" @click="clearShortcut">清除</button>
              </div>
              <div class="zwf-text-faint" style="font-size: 12px;">
                提示：浏览器扩展全局快捷键需在 chrome://extensions/shortcuts 配置；此处设置的是页面内监听的快捷键。
              </div>
              <div v-if="shouldShow('shortcut')" class="zwf-error">{{ errors.shortcut }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="zwf-modal-footer">
        <button class="zwf-btn" @click="emit('close')">取消</button>
        <button class="zwf-btn zwf-btn-primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
