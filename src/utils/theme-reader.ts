/**
 * 从扩展 Shadow DOM 读取主题 CSS 变量
 *
 * 用于 translate-popup / translate-click 等注入到 document.body 的组件，
 * 它们无法直接访问 Shadow DOM 内的 :host 变量。
 */

/** 暗色主题默认值（当无法读取到变量时使用） */
const DARK_DEFAULTS: Record<string, string> = {
  '--aib-primary': '#a855f7',
  '--aib-primary-soft': 'rgba(168,85,247,0.08)',
  '--aib-primary-glow': 'rgba(168,85,247,0.3)',
  '--aib-bg': '#0d0816',
  '--aib-bg-soft': '#130e20',
  '--aib-bg-hover': '#1a142c',
  '--aib-bg-card': '#120d1e',
  '--aib-border': 'rgba(168,85,247,0.12)',
  '--aib-border-strong': 'rgba(168,85,247,0.25)',
  '--aib-text': '#f3e8ff',
  '--aib-text-soft': '#c084fc',
  '--aib-text-faint': '#7c3aed',
  '--aib-danger': '#ef4444',
  '--aib-danger-bg': 'rgba(239,68,68,0.12)',
  '--aib-danger-border': 'rgba(239,68,68,0.3)',
  '--aib-warning': '#f59e0b',
  '--aib-warning-bg': 'rgba(245,158,11,0.12)',
  '--aib-warning-border': 'rgba(245,158,11,0.3)',
  '--aib-success': '#22c55e',
  '--aib-text-on-primary': '#ffffff',
  '--aib-overlay': 'rgba(0,0,0,0.5)',
  '--aib-overlay-heavy': 'rgba(0,0,0,0.65)',
  '--aib-highlight': 'rgba(255,213,0,0.3)',
  '--aib-md-code-bg': '#1e1e2e',
  '--aib-md-code-color': '#cdd6f4',
}

/** 缓存：避免每次都遍历 DOM */
let cachedHost: HTMLElement | null = null
let cacheValid = false

/** 查找扩展的 Shadow DOM host 元素 */
function findExtensionHost(): HTMLElement | null {
  if (cachedHost && cacheValid) return cachedHost
  // 通过 data 属性或 shadow DOM 查找
  const candidates = document.querySelectorAll('[data-aib-host], aib-app, .aib-root-host')
  for (const el of candidates) {
    if (el.shadowRoot) {
      cachedHost = el as HTMLElement
      cacheValid = true
      return cachedHost
    }
  }
  // 尝试查找所有带 shadow root 的自定义元素
  const allElements = document.querySelectorAll('*')
  for (const el of allElements) {
    if (el.shadowRoot && (el as HTMLElement).style.getPropertyValue('--aib-primary')) {
      cachedHost = el as HTMLElement
      cacheValid = true
      return cachedHost
    }
  }
  return null
}

/**
 * 读取单个 CSS 变量值
 * @param name 变量名，如 '--aib-primary'
 * @returns 变量值（含 fallback）
 */
export function getThemeVar(name: string): string {
  const host = findExtensionHost()
  if (host) {
    const val = getComputedStyle(host).getPropertyValue(name).trim()
    if (val) return val
  }
  return DARK_DEFAULTS[name] || ''
}

/**
 * 获取一组主题变量的值（用于批量注入 inline style）
 */
export function getThemeVars(names: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of names) {
    result[name] = getThemeVar(name)
  }
  return result
}

/**
 * 使缓存失效（主题切换时调用）
 */
export function invalidateThemeCache(): void {
  cacheValid = false
}
