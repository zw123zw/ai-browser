import { inputHistoryStorage } from './index';

const INPUT_HISTORY_MAX = 100;

/** 将文本输入推入历史记录（连续去重，过滤空文本） */
export async function pushInputHistory(text: string) {
  if (!text.trim()) return;
  const history = await inputHistoryStorage.getValue();
  // 连续去重：与最后一条相同则跳过
  if (history.length > 0 && history[history.length - 1] === text) return;
  history.push(text);
  // 超过上限截掉头部
  if (history.length > INPUT_HISTORY_MAX) {
    history.splice(0, history.length - INPUT_HISTORY_MAX);
  }
  await inputHistoryStorage.setValue(history);
}
