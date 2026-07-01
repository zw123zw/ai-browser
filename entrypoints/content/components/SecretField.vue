<script setup lang="ts">
/**
 * SecretField — 密码/密钥字段的「显示态+编辑态」组件
 *
 * 默认显示掩码文字 ••••••••，点击「修改」切换为空白输入框。
 * 保存空值 → 不保留（恢复旧值），保存有值 → 写入新值。
 */

import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from '@/src/i18n';

const { t } = useI18n();

const props = defineProps<{
  /** 当前值（真实密钥） */
  modelValue: string;
  /** 是否正在编辑（由父组件控制，确保同一时刻只有一个字段编辑） */
  editing?: boolean;
  /** 输入框占位符 */
  placeholder?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'edit'): void;
  (e: 'cancel'): void;
}>();

const inputValue = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

/** 是否有已保存的值 */
const hasValue = computed(() => !!props.modelValue);

/** 进入编辑态 */
function startEdit() {
  inputValue.value = '';
  emit('edit');
  nextTick(() => inputRef.value?.focus());
}

/** 保存 */
function save() {
  const val = inputValue.value.trim();
  if (val) {
    emit('update:modelValue', val);
  }
  // 空值 → 不保存，保持旧值
  emit('cancel'); // 退出编辑态
}

/** 取消 */
function cancel() {
  inputValue.value = '';
  emit('cancel');
}

/** 编辑态切换时自动聚焦 */
watch(() => props.editing, (editing) => {
  if (editing) {
    nextTick(() => inputRef.value?.focus());
  }
});
</script>

<template>
  <div class="aib-secret-field">
    <!-- 显示态 -->
    <template v-if="!editing">
      <span class="aib-secret-mask">{{ hasValue ? '••••••••' : '' }}</span>
      <button class="aib-btn aib-btn-sm aib-btn-outline" @click="startEdit">
        {{ t('common.edit') }}
      </button>
    </template>

    <!-- 编辑态 -->
    <template v-else>
      <input
        ref="inputRef"
        v-model="inputValue"
        type="text"
        class="aib-input aib-secret-input"
        :placeholder="placeholder"
        @keydown.enter.prevent="save"
        @keydown.escape.prevent="cancel"
      />
      <button class="aib-btn aib-btn-sm aib-btn-primary" @click="save">
        {{ t('common.save') }}
      </button>
      <button class="aib-btn aib-btn-sm aib-btn-ghost" @click="cancel">
        {{ t('common.cancel') }}
      </button>
    </template>
  </div>
</template>
