/** 解析并匹配快捷键，shortcut 格式如 "Ctrl+Shift+B" */
export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false;
  const parts = shortcut.split('+').map((s) => s.trim().toLowerCase());
  const wantCtrl = parts.includes('ctrl') || parts.includes('control');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt') || parts.includes('option');
  const wantMeta =
    parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
  const key = parts[parts.length - 1];
  if (!key) return false;
  return (
    e.ctrlKey === wantCtrl &&
    e.shiftKey === wantShift &&
    e.altKey === wantAlt &&
    e.metaKey === wantMeta &&
    e.key.toLowerCase() === key.toLowerCase()
  );
}

/** 把按键事件转成 "Ctrl+Shift+B" 形式 */
export function eventToShortcut(e: KeyboardEvent): string | null {
  // 单独的修饰键不算
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  // 至少需要一个修饰键
  if (parts.length < 2) return null;
  return parts.join('+');
}
