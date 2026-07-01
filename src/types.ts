// 通用类型定义

/** 附件类型分类 */
export type AttachmentType = 'image' | 'text' | 'code' | 'pdf' | 'word' | 'excel' | 'binary';

/** 统一附件接口 */
export interface Attachment {
  id: string;
  type: AttachmentType;
  /** 原始文件名 */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mimeType: string;
  /** 图片: base64 dataURL */
  dataUrl?: string;
  /** 文本/代码/PDF/Office 提取的文本内容 */
  content?: string;
  /** 代码语言标识（用于语法高亮） */
  lang?: string;
  /** 内容是否被截断（超过 500KB） */
  truncated?: boolean;
}

export type Provider =
  | 'openai'        // OpenAI 兼容
  | 'anthropic'     // Anthropic Claude
  | 'gemini'        // Google Gemini
  | 'custom'        // 自定义
  | 'qwen'          // 通义千问（阿里）
  | 'wenxin'        // 文心一言（百度）
  | 'zhipu'         // 智谱清言
  | 'deepseek'      // DeepSeek
  | 'moonshot'      // Moonshot (Kimi)
  | 'doubao'        // 豆包（字节火山引擎）
  | 'grok'          // Grok (xAI)

/** 单条聊天消息（标准化结构） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** 普通文本内容 */
  content: string;
  /** 深度思考内容（可选） */
  reasoning?: string;
  /** 统一附件（图片 OCR 文字 + 文件） */
  attachments?: Attachment[];
  /** 创建时间 */
  timestamp: number;
  /** 状态：发送中 / 完成 / 错误 / 已取消 */
  status?: 'sending' | 'streaming' | 'done' | 'error' | 'aborted';
  errorMessage?: string;
  /** 该消息发送时是否启用了深度思考（用于控制 UI 是否渲染思考块） */
  reasoningEnabled?: boolean;
}

/** 模型配置 */
export interface ModelConfig {
  id: string;
  /** 用于显示 */
  label: string;
  /** 协议 */
  provider: Provider;
  /** 真实模型名（请求 body 用） */
  modelName: string;
  /** 是否支持思考 */
  reasoning?: boolean;
  /** 是否支持图片 */
  vision?: boolean;
  /** 每模型独立 API 配置（可选，不填则用全局） */
  baseUrl?: string;
  apiKey?: string;
  /** 认证字段：bearer / api-key / access-token / authorization */
  authField?: string;
  /** 供应商官网地址 */
  website?: string;
}

/** 单个会话 */
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** 当前会话使用的模型 id */
  modelId: string;
  /** 滚动条位置 */
  scrollTop?: number;
  /** 输入框草稿（独立到每个会话） */
  draftText?: string;
  draftAttachments?: Attachment[];
  /** 深度思考开关（独立到每个会话） */
  reasoningEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 语音引擎类型 */
export type VoiceEngineType = 'web-speech' | 'iflytek' | 'baidu' | 'tencent'

/** 引擎配置项 */
export interface EngineConf {
  engineType: string
  appId: string
  apiKey: string
  apiSecret: string
}

/** 全局设置 */
export interface AppSettings {
  /** 协议 */
  provider: Provider;
  /** 请求地址 */
  baseUrl: string;
  /** 密钥 */
  apiKey: string;
  /** 认证字段 */
  authField?: string;
  /** 可选模型列表 */
  models: ModelConfig[];
  /** 默认模型 id */
  defaultModelId: string;
  /** 抽屉宽度（vw 百分比，40 - 100） */
  drawerWidth: number;
  /** 主题色（hex） */
  primaryColor: string;
  /** 主题 id */
  theme?: string;
  /** 唤起插件的快捷键，如 "Ctrl+Shift+B" */
  shortcut: string;
  /** 最大会话数 */
  maxConversations?: number;
  /** 单会话最大上下文消息数 */
  maxContext?: number;
  /** 划词操作：auto=自动发送, manual=填入输入框, off=关闭 */
  autoSendSelection?: 'auto' | 'manual' | 'off';
  /** 翻译目标语言（如 '中文'、'English'、'日本語'） */
  translateTargetLang?: string;
  /** 翻译模式：selection=划词翻译, auto=自动翻译, click=点击翻译, off=关闭 */
  translateMode?: 'selection' | 'auto' | 'click' | 'off';
  /** 笔记模式：selection=划词笔记, click=点击笔记, auto=自动笔记, off=关闭 */
  noteMode?: NoteMode;
  /** 网页自动化开关（默认 true）：关闭后移除所有自动化提示词，退化为纯聊天 */
  automationEnabled?: boolean;
  /** 界面语言：zh-CN=中文, en-US=英文 */
  locale?: 'zh-CN' | 'en-US';

  // ── 语音配置 ──
  /** 语音引擎类型 */
  voiceEngineType?: VoiceEngineType;
  /** 引擎 appId */
  voiceAppId?: string;
  /** 引擎 apiKey */
  voiceApiKey?: string;
  /** 引擎 apiSecret */
  voiceApiSecret?: string;
  /** 所有引擎的默认配置（从 voice-config.json 合并） */
  voiceEngineConfs?: EngineConf[];
  /** 语音识别语言 */
  voiceRecognitionLang?: string;
  /** 唤醒词 */
  voiceWakeWord?: string;
  /** 常驻语音模式 */
  voiceAlwaysOn?: boolean;
  /** 启用 TTS 播报 */
  voiceEnableTts?: boolean;
  /** TTS 语速 */
  voiceTtsRate?: number;
  /** TTS 音量 */
  voiceTtsVolume?: number;
  /** 语音缓冲超时（ms） */
  voiceBufferTimeout?: number;
  /** 语音空闲超时（ms） */
  voiceIdleTimeout?: number;
  /** 语音助手模式：chat=文字聊天, voice=语音助手 */
  voiceMode?: 'chat' | 'voice';

  // ── 用户数据 ──
  /** 输入历史 */
  inputHistory?: string[];

  /** @deprecated 已废弃，改用 translateMode */
  selectionTranslate?: boolean;
  /** @deprecated 已废弃，改用 translateMode */
  autoTranslate?: boolean;
  /** @deprecated 已废弃，改用 translateMode */
  clickTranslate?: boolean;
}

/** Adapter 流式回调每一段 */
export interface StreamChunk {
  /** 增量文本 */
  delta?: string;
  /** 增量思考文本 */
  reasoningDelta?: string;
  /** 完成原因 */
  done?: boolean;
}

export interface ChatRequestOptions {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  provider?: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════
// 笔记系统
// ═══════════════════════════════════════════════════════════════

/** 笔记模式 */
export type NoteMode = 'selection' | 'click' | 'auto' | 'off';

/** 单条笔记条目 */
export interface NoteEntry {
  /** 唯一 id */
  id: string;
  /** 笔记内容（markdown） */
  content: string;
  /** 来源 URL */
  url: string;
  /** 保存时的滚动条位置 */
  scrollY: number;
  /** 划词/选中的文本（可选） */
  selectedText?: string;
  /** 来源类型：selection=划词, click=点击, chat=聊天消息收藏, auto=自动笔记 */
  source: 'selection' | 'click' | 'chat' | 'auto';
  /** 保存时间 */
  timestamp: number;
}

/** 笔记标题（包含多条条目） */
export interface NoteTitle {
  /** 唯一 id */
  id: string;
  /** 标题名 */
  title: string;
  /** 条目列表（按时间排序） */
  entries: NoteEntry[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 全部笔记数据 */
export interface NotesData {
  titles: NoteTitle[];
}
