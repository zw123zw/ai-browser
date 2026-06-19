/**
 * 统一输入处理层类型定义
 */

import type { Command } from '@/src/browser/types'

/** 输入上下文 */
export interface InputContext {
  text: string           // 用户输入文本
  mode: 'text' | 'voice' // 输入模式
}

/** 输入路由结果 */
export type InputResult =
  | { type: 'builtin'; command: string; args: string }
  | { type: 'ai' }

/** 流水线回调 */
export interface PipelineCallbacks {
  /** Phase 1 聊天回复开始（创建占位消息） */
  onChatStart: () => void

  /** Phase 1 聊天回复增量（流式更新） */
  onChatDelta: (delta: string, reasoningDelta?: string, clearContent?: boolean) => void

  /** Phase 1 聊天回复结束 */
  onChatEnd: () => void

  /** Phase 1 检测到操作意图（清除流式消息中的原始标签内容） */
  onActionDetected: () => void

  /** Phase 1 聊天回复（纯文本，无流式时使用） */
  onChatMessage: (text: string) => void

  /** 即将执行的指令列表（解析完成后、执行前展示） */
  onCommandsParsed: (commands: Command[], currentStep?: number) => void

  /** 单条指令执行结果 */
  onCommandResult: (action: string, success: boolean, message: string) => void

  /** 全部指令执行成功（用于存储 assistant 消息到对话历史） */
  onAllCommandsDone?: (userText: string, commands: Command[]) => void

  /** 重试消息（展示给用户看重试过程） */
  onRetryMessage: (message: string, currentStep?: number, failedCommand?: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null) => void

  /** 错误（超过重试上限后） */
  onError: (message: string) => void

  /** AI 请求用户输入（返回用户输入的文本，pipeline 暂停等待） */
  onNeedInput: (prompt: string) => Promise<string>
}
