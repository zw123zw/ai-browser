/**
 * 文件类型检测与分类工具
 */
import type { AttachmentType } from '@/src/types';

/** 代码文件扩展名 → 语言标识映射 */
const CODE_EXTENSIONS: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  // Web
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  vue: 'vue', svelte: 'svelte',
  // Python
  py: 'python', pyw: 'python', pyi: 'python',
  // Java / Kotlin / Scala
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala',
  // C / C++ / C#
  c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  // Ruby
  rb: 'ruby', erb: 'ruby',
  // PHP
  php: 'php',
  // Swift
  swift: 'swift',
  // Shell
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  // SQL
  sql: 'sql', mysql: 'sql', pgsql: 'sql', sqlite: 'sql',
  // 数据/配置
  json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  xml: 'xml', svg: 'xml',
  ini: 'ini', cfg: 'ini', conf: 'ini',
  env: 'bash',
  // 标记语言
  md: 'markdown', mdx: 'markdown',
  tex: 'latex',
  rst: 'rst',
  // 其他
  lua: 'lua', r: 'r', R: 'r',
  pl: 'perl', pm: 'perl',
  hs: 'haskell', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', clj: 'clojure',
  dart: 'dart', zig: 'zig', nim: 'nim', v: 'v',
  groovy: 'groovy', gradle: 'groovy',
  cmake: 'cmake', makefile: 'makefile', mk: 'makefile',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  graphql: 'graphql', gql: 'graphql',
  prisma: 'prisma',
};

/** 文本文件扩展名（非代码） */
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'out', 'err',
  'csv', 'tsv',
  'readme', 'license', 'changelog', 'authors', 'contributors',
  'gitignore', 'npmignore', 'dockerignore', 'eslintignore', 'prettierignore',
  'editorconfig', 'prettierrc', 'eslintrc', 'stylelintrc',
  'lock', 'sum', // package-lock.json, go.sum 等
]);

/** PDF 扩展名 */
const PDF_EXTENSIONS = new Set(['pdf']);

/** Word 扩展名 */
const WORD_EXTENSIONS = new Set(['doc', 'docx']);

/** Excel 扩展名 */
const EXCEL_EXTENSIONS = new Set(['xls', 'xlsx', 'csv', 'tsv']);

/** 图片 MIME 前缀 */
const IMAGE_MIME_PREFIX = 'image/';

/** Office MIME 类型 */
const PDF_MIMES = new Set(['application/pdf']);
const WORD_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const EXCEL_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/tab-separated-values',
]);

/**
 * 从文件名提取扩展名（小写）
 */
export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * 检测文件的 AttachmentType
 */
export function detectFileType(file: File): AttachmentType {
  const ext = getExtension(file.name);
  const mime = file.type.toLowerCase();

  // 图片：MIME 前缀优先
  if (mime.startsWith(IMAGE_MIME_PREFIX)) return 'image';

  // PDF
  if (PDF_EXTENSIONS.has(ext) || PDF_MIMES.has(mime)) return 'pdf';

  // Word
  if (WORD_EXTENSIONS.has(ext) || WORD_MIMES.has(mime)) return 'word';

  // Excel（排除 csv/tsv，它们同时也是文本）
  if (EXCEL_MIMES.has(mime) && !['csv', 'tsv'].includes(ext)) return 'excel';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';

  // 代码
  if (ext in CODE_EXTENSIONS) return 'code';

  // 文本
  if (TEXT_EXTENSIONS.has(ext)) return 'text';

  // MIME 兜底：text/* 视为文本
  if (mime.startsWith('text/')) return 'text';

  // 其他
  return 'binary';
}

/**
 * 获取代码语言标识（用于语法高亮）
 */
export function getCodeLang(filename: string): string | undefined {
  const ext = getExtension(filename);
  return CODE_EXTENSIONS[ext];
}

/**
 * 获取文件类型的显示图标
 */
export function getFileTypeIcon(type: AttachmentType): string {
  switch (type) {
    case 'image': return '🖼️';
    case 'text': return '📄';
    case 'code': return '💻';
    case 'pdf': return '📕';
    case 'word': return '📘';
    case 'excel': return '📊';
    case 'binary': return '📦';
  }
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
