import { useSettingsStore } from '@/src/stores/settings';

const INPUT_HISTORY_MAX = 100;

/** 将文本输入推入历史记录（连续去重，过滤空文本） */
export async function pushInputHistory(text: string) {
  if (!text.trim()) return;
  try {
    const settingsStore = useSettingsStore();
    const history = [...(settingsStore.settings.inputHistory || [])];
    // 连续去重：与最后一条相同则跳过
    if (history.length > 0 && history[history.length - 1] === text) return;
    history.push(text);
    // 超过上限截掉头部
    if (history.length > INPUT_HISTORY_MAX) {
      history.splice(0, history.length - INPUT_HISTORY_MAX);
    }
    settingsStore.settings.inputHistory = history;
  } catch {
    // 扩展上下文失效时静默忽略
  }
}
