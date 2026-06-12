import { reactive } from 'vue';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

const toasts = reactive<Toast[]>([]);
let seed = 0;

function show(message: string, type: ToastType = 'info', duration = 3000): string {
  const id = `t${++seed}`;
  toasts.push({ id, message, type });
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
}

function dismiss(id: string) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

export function useToast() {
  return {
    toasts,
    info: (m: string, d?: number) => show(m, 'info', d),
    success: (m: string, d?: number) => show(m, 'success', d),
    warning: (m: string, d?: number) => show(m, 'warning', d),
    error: (m: string, d?: number) => show(m, 'error', d),
    dismiss,
  };
}
