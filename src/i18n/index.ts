import { ref, computed } from 'vue';
import zhCN from './zh-CN.json';
import enUS from './en-US.json';

export type Locale = 'zh-CN' | 'en-US';

type Messages = typeof zhCN;

const messages: Record<Locale, Messages> = { 'zh-CN': zhCN, 'en-US': enUS };

/** 响应式语言状态 */
const locale = ref<Locale>('zh-CN');

/** 初始化语言（从 settings store 调用） */
export function initI18n(initialLocale: Locale) {
  locale.value = initialLocale;
}

/** 获取翻译文本 */
function t(key: string, vars?: Record<string, string | number>): string {
  const keys = key.split('.');
  let value: unknown = messages[locale.value];
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key; // key 不存在时返回 key 本身
    }
  }
  if (typeof value !== 'string') return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

/** composable：在组件中使用 */
export function useI18n() {
  return {
    t,
    locale,
    setLocale: (l: Locale) => { locale.value = l; },
  };
}
