// 通用类型定义

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

/** 单条聊天消息（标准化结构） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** 普通文本内容 */
  content: string;
  /** 深度思考内容（可选） */
  reasoning?: string;
  /** 多模态附件 */
  images?: string[]; // base64 dataURL
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
  apiFormat?: string;
  authField?: string;
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
  draftImages?: string[];
  /** 深度思考开关（独立到每个会话） */
  reasoningEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 全局设置 */
export interface AppSettings {
  /** 协议 */
  provider: Provider;
  /** 请求地址 */
  baseUrl: string;
  /** 密钥 */
  apiKey: string;
  /** API 格式 */
  apiFormat?: string;
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
  messages: ChatMessage[];
  signal?: AbortSignal;
}
