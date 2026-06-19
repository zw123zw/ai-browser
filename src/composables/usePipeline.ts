/**
 * 输入流水线 Composable
 *
 * 将 InputPipeline 集成到 Vue 组件中。
 * 指令解析后用特殊消息展示在聊天中。
 */

import { ref, reactive } from 'vue'
import { InputPipeline } from '@/src/input'
import { useConversationsStore } from '@/src/stores/conversations'
import { useSettingsStore } from '@/src/stores/settings'
import { Logger } from '@/src/utils/logger'
import type { PipelineCallbacks } from '@/src/input/types'
import type { Command, ActionResult, ChatMessage } from '@/src/types'
import type { QueuedTask } from '@/src/storage'
import { queuedTaskStorage } from '@/src/storage'
import { v4 as uuid } from 'uuid'

const log = new Logger('usePipeline')

const isProcessing = ref(false)
/** AI 等待用户输入时的提示文本（null = 不在等待状态） */
const waitingInputPrompt = ref<string | null>(null)
/** 等待用户输入的 Promise resolve/reject 函数 */
let waitingInputResolve: ((value: string) => void) | null = null
let waitingInputReject: ((reason?: unknown) => void) | null = null

/** 模块级别的 abort 引用，供外部（清除会话/缓存）调用 */
let _abortFn: (() => Promise<void>) | null = null

/** 中止 pipeline 并等待结束（模块级函数，供清除会话/缓存时调用） */
export async function abortPipeline(): Promise<void> {
  await _abortFn?.()
}

export function usePipeline() {
  const convStore = useConversationsStore()
  const settingsStore = useSettingsStore()

  let pipeline: InputPipeline | null = null
  /** 当前流式消息（用于打字机效果） */
  let currentStreamingMsg: ChatMessage | null = null
  /** 当前请求的 AbortController */
  let currentAborter: AbortController | null = null
  /** pipeline 停止后的回调（供 abort() 等待） */
  let stoppedResolve: (() => void) | null = null

  function getRecentMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const conv = convStore.conversation
    if (!conv) return []
    // 排除当前轮次的两条消息：
    // 1. ChatPanel 预先 push 的用户消息
    // 2. onChatStart() 创建的 assistant 占位消息
    // 这样 callAI() 不会将历史中的当前用户消息与当前输入重复，
    // 且无历史时 validMsgCount === 0，正确走 system prompt 拼接逻辑
    const msgs = conv.messages.slice(0, -2)
    return msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 300) }))
  }

  function getPipeline(): InputPipeline {
    if (!pipeline) {
      pipeline = new InputPipeline({
        getSettings: () => settingsStore.settings,
        getModelId: () => convStore.conversation?.modelId || settingsStore.settings.defaultModelId,
        getRecentMessages,
        getSignal: () => currentAborter?.signal,
        onBuiltinCommand: (command, args) => {
          log.info('内置命令', { command, args })
          if (command === 'stop') {
            convStore.abort()
            abort()
            addSystemMessage('已停止当前操作')
          } else if (command === 'help') {
            addSystemMessage('可用命令：/stop（停止）、/help（帮助）')
          } else if (command === 'unknown') {
            addSystemMessage(`未知命令 /${args}，可用：/stop、/help`)
          } else {
            addSystemMessage(`命令 /${command} 暂未实现`)
          }
        },
      })
    }
    return pipeline
  }

  /** 添加系统消息 */
  function addSystemMessage(content: string) {
    if (!convStore.conversation) return
    convStore.conversation.messages.push({
      id: uuid(),
      role: 'system',
      content,
      timestamp: Date.now(),
      status: 'done',
    })
  }

  /** 格式化指令详情（用于执行中和重试消息） */
  function formatCommandDetail(c: { action: string; elementId?: string; description?: string; text?: string; url?: string }): string {
    return `${c.action}${c.description ? ` — ${c.description}` : ''}${c.url ? ` → ${c.url}` : ''}${c.text ? ` "${c.text}"` : ''}`
  }

  /**
   * 处理用户输入
   */
  async function processInput(text: string): Promise<void> {
    log.info('═══ processInput 开始 ═══', { text })
    isProcessing.value = true
    currentStreamingMsg = null
    const ac = new AbortController()
    currentAborter = ac

    try {
      const callbacks: PipelineCallbacks = {
        // Phase 1 聊天回复开始（创建占位消息）
        onChatStart: () => {
          log.info('[回调] onChatStart')
          if (!convStore.conversation) return
          // 创建占位消息，实现打字机效果
          currentStreamingMsg = reactive<ChatMessage>({
            id: uuid(),
            role: 'assistant',
            content: '',
            reasoning: '',
            timestamp: Date.now(),
            status: 'streaming',
          })
          convStore.conversation.messages.push(currentStreamingMsg)
          convStore.conversation.updatedAt = Date.now()
        },

        // Phase 1 聊天回复增量（流式更新）
        onChatDelta: (delta, reasoningDelta, clearContent) => {
          if (!currentStreamingMsg) return
          if (clearContent) {
            currentStreamingMsg.content = ''
            return
          }
          if (delta) currentStreamingMsg.content += delta
          if (reasoningDelta) currentStreamingMsg.reasoning = (currentStreamingMsg.reasoning || '') + reasoningDelta
          if (convStore.conversation) convStore.conversation.updatedAt = Date.now()
        },

        // Phase 1 聊天回复结束
        onChatEnd: () => {
          log.info('[回调] onChatEnd')
          if (currentStreamingMsg) {
            currentStreamingMsg.status = 'done'
            currentStreamingMsg = null
          }
        },

        // Phase 1 检测到操作意图 → 更新为"执行中"状态（保留视觉反馈）
        onActionDetected: () => {
          log.info('[回调] onActionDetected')
          if (currentStreamingMsg) {
            currentStreamingMsg.content = '正在执行操作...'
            currentStreamingMsg.status = 'done'
          }
        },

        // Phase 1 聊天回复（纯文本，无流式时使用）
        onChatMessage: (chatText) => {
          log.info('[回调] onChatMessage', { length: chatText.length, preview: chatText.slice(0, 80) })
          if (!convStore.conversation) return
          convStore.conversation.messages.push({
            id: uuid(),
            role: 'assistant',
            content: chatText,
            timestamp: Date.now(),
            status: 'done',
          })
        },

        // 解析到指令列表 → 替换"执行中"消息为具体指令列表
        onCommandsParsed: (commands, currentStep) => {
          log.info('[回调] onCommandsParsed', {
            count: commands.length,
            currentStep,
            commands: commands.map(c => ({ action: c.action, elementId: c.elementId, description: c.description, url: c.url })),
          })
          // 移除"正在执行操作..."占位消息
          if (currentStreamingMsg && convStore.conversation) {
            const idx = convStore.conversation.messages.findIndex(m => m.id === currentStreamingMsg!.id)
            if (idx !== -1) convStore.conversation.messages.splice(idx, 1)
            currentStreamingMsg = null
          }
          const step = currentStep || 1
          const cmdDetail = formatCommandDetail(commands[0])
          addSystemMessage(`🔧 **正在执行第 ${step} 条指令：**\n${step}. ${cmdDetail}`)
        },

        // 单条指令执行结果
        onCommandResult: (action, success, message) => {
          log.info('[回调] onCommandResult', { action, success, message })
          const icon = success ? '✅' : '❌'
          addSystemMessage(`${icon} **${action}** — ${message}`)
        },

        // 全部指令执行成功 → 存为 assistant 消息，让 AI 知道已执行过什么
        onAllCommandsDone: (userText, commands) => {
          if (!convStore.conversation) return
          const summary = commands
            .map(c => `${c.action}${c.description ? `(${c.description})` : ''}${c.url ? ` → ${c.url}` : ''}`)
            .join('; ')
          convStore.conversation.messages.push({
            id: uuid(),
            role: 'assistant',
            content: `已执行: ${summary}`,
            timestamp: Date.now(),
            status: 'done',
          })
          log.info('[回调] onAllCommandsDone → assistant 消息已存入对话历史', { summary })
        },

        // 重试消息（清理占位消息）
        onRetryMessage: (message, currentStep, failedCommand) => {
          log.info('[回调] onRetryMessage', { message, currentStep, failedCommand })
          if (currentStreamingMsg && convStore.conversation) {
            const idx = convStore.conversation.messages.findIndex(m => m.id === currentStreamingMsg!.id)
            if (idx !== -1) convStore.conversation.messages.splice(idx, 1)
            currentStreamingMsg = null
          }
          const step = currentStep || 1
          const cmdDetail = failedCommand ? formatCommandDetail(failedCommand) : ''
          const retryMsg = cmdDetail
            ? `🔄 **正在重试第 ${step} 条指令：**\n${step}. ${cmdDetail}`
            : `🔄 **正在重试第 ${step} 条指令**`
          addSystemMessage(retryMsg)
        },

        // 最终错误
        onError: (message) => {
          log.warn('[回调] onError', { message })
          addSystemMessage(`❌ ${message}`)
        },

        // AI 请求用户输入
        onNeedInput: (prompt) => {
          log.info('[回调] onNeedInput', { prompt })
          addSystemMessage(`💬 **AI 需要您的输入：** ${prompt}`)
          waitingInputPrompt.value = prompt
          return new Promise<string>((resolve, reject) => {
            waitingInputResolve = resolve
            waitingInputReject = reject
          })
        },
      }

      await getPipeline().process({ text, mode: 'text' }, callbacks)
    } catch (error) {
      if (ac.signal.aborted) {
        log.info('═══ processInput 已中止 ═══')
        addSystemMessage('⏹ 已停止')
      } else {
        log.error('═══ processInput 异常 ═══', error)
        addSystemMessage(`处理失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      // 确保流式消息状态正确
      if (currentStreamingMsg && currentStreamingMsg.status === 'streaming') {
        currentStreamingMsg.status = 'done'
      }
      currentStreamingMsg = null
      if (currentAborter === ac) currentAborter = null
      // 清理等待输入状态（pipeline 结束时如果还在等待，说明被取消了）
      if (waitingInputResolve) {
        waitingInputResolve = null
        waitingInputReject = null
        waitingInputPrompt.value = null
      }
      isProcessing.value = false
      stoppedResolve?.()
      stoppedResolve = null
      log.info('═══ processInput 结束 ═══')
    }
  }

  /**
   * 恢复排队任务（navigate 新开页后，新页自动调用）
   */
  async function resumeQueuedTask(task: QueuedTask): Promise<void> {
    log.info('═══ resumeQueuedTask 开始 ═══', { originalRequest: task.originalRequest, completedSteps: task.completedSteps.length })
    isProcessing.value = true
    currentStreamingMsg = null
    const ac = new AbortController()
    currentAborter = ac

    try {
      const callbacks: PipelineCallbacks = {
        onChatStart: () => {},
        onChatDelta: () => {},
        onChatEnd: () => {},
        onActionDetected: () => {
          log.info('[恢复] onActionDetected')
          if (!convStore.conversation) return
          currentStreamingMsg = reactive<ChatMessage>({
            id: uuid(),
            role: 'assistant',
            content: '正在恢复跨页面操作...',
            reasoning: '',
            timestamp: Date.now(),
            status: 'streaming',
          })
          convStore.conversation.messages.push(currentStreamingMsg)
        },
        onChatMessage: () => {},
        onCommandsParsed: (commands, currentStep) => {
          log.info('[恢复] onCommandsParsed', { count: commands.length, currentStep })
          if (currentStreamingMsg && convStore.conversation) {
            const idx = convStore.conversation.messages.findIndex(m => m.id === currentStreamingMsg!.id)
            if (idx !== -1) convStore.conversation.messages.splice(idx, 1)
            currentStreamingMsg = null
          }
          const step = currentStep || 1
          const cmdDetail = formatCommandDetail(commands[0])
          addSystemMessage(`🔧 **正在执行第 ${step} 条指令：**\n${step}. ${cmdDetail}`)
        },
        onCommandResult: (action, success, message) => {
          log.info('[恢复] onCommandResult', { action, success, message })
          const icon = success ? '✅' : '❌'
          addSystemMessage(`${icon} **${action}** — ${message}`)
        },
        onAllCommandsDone: (userText, commands) => {
          if (!convStore.conversation) return
          const summary = commands
            .map(c => `${c.action}${c.description ? `(${c.description})` : ''}${c.url ? ` → ${c.url}` : ''}`)
            .join('; ')
          convStore.conversation.messages.push({
            id: uuid(),
            role: 'assistant',
            content: `已执行: ${summary}`,
            timestamp: Date.now(),
            status: 'done',
          })
          log.info('[恢复] onAllCommandsDone', { summary })
        },
        onRetryMessage: (message, currentStep, failedCommand) => {
          log.info('[恢复] onRetryMessage', { message, currentStep, failedCommand })
          if (currentStreamingMsg && convStore.conversation) {
            const idx = convStore.conversation.messages.findIndex(m => m.id === currentStreamingMsg!.id)
            if (idx !== -1) convStore.conversation.messages.splice(idx, 1)
            currentStreamingMsg = null
          }
          addSystemMessage(message)
        },
        onError: (message) => {
          log.warn('[恢复] onError', { message })
          addSystemMessage(`❌ ${message}`)
        },

        onNeedInput: (prompt) => {
          log.info('[恢复] onNeedInput', { prompt })
          addSystemMessage(`💬 **AI 需要您的输入：** ${prompt}`)
          waitingInputPrompt.value = prompt
          return new Promise<string>((resolve, reject) => {
            waitingInputResolve = resolve
            waitingInputReject = reject
          })
        },
      }

      await getPipeline().resumeQueuedTask(task, callbacks)
    } catch (error) {
      if (ac.signal.aborted) {
        log.info('═══ resumeQueuedTask 已中止 ═══')
        addSystemMessage('⏹ 已停止')
      } else {
        log.error('═══ resumeQueuedTask 异常 ═══', error)
        addSystemMessage(`恢复失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (currentStreamingMsg && currentStreamingMsg.status === 'streaming') {
        currentStreamingMsg.status = 'done'
      }
      currentStreamingMsg = null
      if (currentAborter === ac) currentAborter = null
      if (waitingInputResolve) {
        waitingInputResolve = null
        waitingInputReject = null
        waitingInputPrompt.value = null
      }
      isProcessing.value = false
      stoppedResolve?.()
      stoppedResolve = null
      log.info('═══ resumeQueuedTask 结束 ═══')
    }
  }

  async function executeCommand(cmd: Command): Promise<ActionResult> {
    const { ActionExecutor } = await import('@/src/browser/action-executor')
    return new ActionExecutor().execute(cmd)
  }

  function abort(): Promise<void> {
    log.debug('中止 pipeline 请求')
    // 如果正在等待用户输入，reject Promise 让 pipeline 从 await 中退出
    if (waitingInputReject) {
      waitingInputReject(new DOMException('The operation was aborted.', 'AbortError'))
      waitingInputResolve = null
      waitingInputReject = null
      waitingInputPrompt.value = null
    }
    currentAborter?.abort()
    // 清除跨标签页排队任务，阻止后续标签页继续执行
    queuedTaskStorage.setValue(null).catch(() => {})
    // 如果 pipeline 正在运行，等它真正结束
    if (isProcessing.value) {
      return new Promise<void>(resolve => { stoppedResolve = resolve })
    }
    return Promise.resolve()
  }

  /** 用户提供了 AI 请求的输入，继续执行 pipeline */
  function provideInput(text: string) {
    if (!waitingInputResolve) {
      log.warn('provideInput 调用但无等待中的 Promise')
      return
    }
    log.info('用户提供输入', { text: text.slice(0, 50) })
    const resolve = waitingInputResolve
    waitingInputResolve = null
    waitingInputPrompt.value = null
    // 添加用户输入消息到对话
    addSystemMessage(`📝 **您的输入：** ${text}`)
    resolve(text)
  }

  // 注册模块级 abort 引用
  _abortFn = abort

  return { isProcessing, waitingInputPrompt, processInput, resumeQueuedTask, executeCommand, addSystemMessage, provideInput, abort }
}
