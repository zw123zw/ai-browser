/**
 * 代码过滤器
 *
 * 三层过滤机制，防止代码被翻译 AI 错误翻译：
 * 1. 标签黑名单 - pre/code/samp 直接跳过
 * 2. Class 黑名单 - hljs/language-xxx/code-block/highlight/syntax 跳过
 * 3. 文本正则兜底 - 内联代码替换为占位符
 *
 * 占位符翻译后前端回填原始代码。
 */

// ═══════════════════════════════════════════════════════════════
// Layer 1: 标签黑名单
// ═══════════════════════════════════════════════════════════════

/** 代码标签黑名单（元素整体跳过，不提取文本） */
const CODE_TAGS = new Set(['pre', 'code', 'samp'])

// ═══════════════════════════════════════════════════════════════
// Layer 2: Class 黑名单
// ═══════════════════════════════════════════════════════════════

/** 代码 class 特征关键词 */
const CODE_CLASS_KEYWORDS = [
  'hljs',
  'language-',
  'code-block',
  'highlight',
  'syntax',
  'prism',
  'shiki',
  'codemirror',
  'ace_',
]

// ═══════════════════════════════════════════════════════════════
// Layer 3: 文本正则（内联代码检测）
// ═══════════════════════════════════════════════════════════════

/**
 * 内联代码特征正则列表
 *
 * 按优先级排列：先匹配长模式，避免短模式截断。
 * 每个正则用全局模式，filterCodeText 中按顺序替换。
 */
const CODE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // 多行注释
  { pattern: /\/\*[\s\S]*?\*\//g, label: 'block-comment' },
  // 反引号包裹（模板字符串或行内代码）
  { pattern: /`[^`\n]+`/g, label: 'backtick' },
  // 单行注释
  { pattern: /\/\/[^\n]*/g, label: 'line-comment' },
  // URL
  { pattern: /https?:\/\/[^\s<>)"'，。！？]+/g, label: 'url' },
  // 命令行（$ 或 > 或 # 开头）
  { pattern: /^[\s]*[$>#][ \t]+[^\n]+/gm, label: 'cli' },
  // JSON 片段（花括号内含引号冒号）
  { pattern: /\{[^}]*"[^"]*"\s*:[^}]*\}/g, label: 'json' },
  // 函数调用 foo(...)
  { pattern: /\b[a-zA-Z_$][\w$]*\s*\([^)]*\)/g, label: 'func-call' },
  // 属性链 obj.prop.method
  { pattern: /\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*){2,}\b/g, label: 'prop-chain' },
  // 花括号块（非中文语境）
  { pattern: /\{[^{}\n]{2,}\}/g, label: 'brace-block' },
  // 方括号块（非中文语境）
  { pattern: /\[[^\[\]\n]{2,}\]/g, label: 'bracket-block' },
  // 编程关键字（连续出现 2 个以上才判定）
  { pattern: /\b(?:function|const|let|var|return|import|export|class|interface|type|enum|if|else|for|while|switch|case|break|continue|try|catch|throw|new|this|typeof|instanceof|async|await|yield|Promise|void|null|undefined|true|false)\b(?:\s+\b(?:function|const|let|var|return|import|export|class|interface|type|enum|if|else|for|while|switch|case|break|continue|try|catch|throw|new|this|typeof|instanceof|async|await|yield|Promise|void|null|undefined|true|false)\b)+/g, label: 'keywords' },
  // 版本号 x.y.z
  { pattern: /\b\d+\.\d+\.\d+(?:[\w.-]*)\b/g, label: 'version' },
  // 文件路径
  { pattern: /(?:\/[\w.-]+){2,}\.\w+/g, label: 'filepath' },
]

// ═══════════════════════════════════════════════════════════════
// 公共 API
// ═══════════════════════════════════════════════════════════════

export interface FilterResult {
  /** 过滤后的文本（含占位符） */
  text: string
  /** 占位符映射：编号 → 原始代码 */
  placeholders: Map<string, string>
}

/**
 * 判断元素是否是代码容器（Layer 1 + Layer 2）
 *
 * 用于自动翻译遍历 DOM 时跳过代码块元素。
 */
export function isCodeElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (CODE_TAGS.has(tag)) return true

  const className = el.className
  if (typeof className === 'string') {
    const lower = className.toLowerCase()
    for (const keyword of CODE_CLASS_KEYWORDS) {
      if (lower.includes(keyword)) return true
    }
  }

  return false
}

/**
 * 过滤文本中的代码，替换为占位符（Layer 3）
 *
 * 输入原始文本，输出 { 过滤后文本, 占位符映射 }。
 * 翻译完成后调用 restorePlaceholders() 回填。
 */
export function filterCodeText(text: string): FilterResult {
  const placeholders = new Map<string, string>()
  let counter = 0
  let result = text

  for (const { pattern } of CODE_PATTERNS) {
    // 每次用新的 RegExp（lastIndex 重置）
    const re = new RegExp(pattern.source, pattern.flags)
    result = result.replace(re, (match) => {
      // 跳过纯中文内容（避免误杀中文方括号/花括号）
      if (/^[一-鿿\s，。！？、；：""''（）【】《》]+$/.test(match)) {
        return match
      }
      counter++
      const key = `{{code_${String(counter).padStart(2, '0')}}}`
      placeholders.set(key, match)
      return key
    })
  }

  return { text: result, placeholders }
}

/**
 * 将占位符回填为原始代码
 */
export function restorePlaceholders(text: string, placeholders: Map<string, string>): string {
  let result = text
  for (const [key, original] of placeholders) {
    result = result.split(key).join(original)
  }
  return result
}
