/**
 * 语音状态管理
 *
 * 管理语音识别的启停状态、识别结果、对话历史、置信度、播报状态
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { VoiceStatus } from '@/src/voice/recognition';
import type { ParsedCommand } from '@/src/voice/commandParser';

/** 语音会话状态 */
export type SessionState =
  | 'idle'        // 空闲
  | 'listening'   // 聆听中
  | 'evaluating'  // 评估置信度
  | 'processing'  // LLM/自动化处理中
  | 'speaking'    // 语音播报中

/** 语音对话消息 */
export interface VoiceMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 自动化指令结果 */
  actionResult?: {
    action: string;
    success: boolean;
    message: string;
  };
  timestamp: number;
}

export const useVoiceStore = defineStore('voice', () => {
  /** 语音识别状态 */
  const status = ref<VoiceStatus>('idle');

  /** 会话状态机状态 */
  const sessionState = ref<SessionState>('idle');

  /** 当前识别的文本（中间结果） */
  const interimText = ref('');

  /** 最终识别的文本 */
  const finalText = ref('');

  /** 最近一次识别置信度 */
  const confidence = ref(0);

  /** 语音对话历史 */
  const messages = ref<VoiceMessage[]>([]);

  /** 是否正在处理 AI 请求 */
  const isProcessing = ref(false);

  /** 是否正在语音播报 */
  const isSpeaking = ref(false);

  /** 连续对话模式 */
  const continuousMode = ref(true);

  /** 对话消息数量 */
  const messageCount = computed(() => messages.value.length);

  /** 更新状态 */
  function setStatus(newStatus: VoiceStatus) {
    status.value = newStatus;
  }

  /** 更新会话状态 */
  function setSessionState(state: SessionState) {
    sessionState.value = state;
  }

  /** 更新识别文本 */
  function updateText(text: string, isFinal: boolean, conf?: number) {
    if (isFinal) {
      finalText.value = text;
      interimText.value = '';
      if (conf !== undefined) {
        confidence.value = conf;
      }
    } else {
      interimText.value = text;
    }
  }

  /** 添加用户消息 */
  function addUserMessage(text: string, command?: ParsedCommand) {
    const msg: VoiceMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  /** 添加 AI 回复 */
  function addAssistantMessage(content: string, actionResult?: VoiceMessage['actionResult']) {
    const msg: VoiceMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content,
      actionResult,
      timestamp: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  /** 添加系统消息 */
  function addSystemMessage(content: string) {
    const msg: VoiceMessage = {
      id: Date.now().toString(),
      role: 'system',
      content,
      timestamp: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  /** 清空对话历史 */
  function clearMessages() {
    messages.value = [];
    interimText.value = '';
    finalText.value = '';
    confidence.value = 0;
  }

  /** 设置处理状态 */
  function setProcessing(value: boolean) {
    isProcessing.value = value;
  }

  /** 设置播报状态 */
  function setSpeaking(value: boolean) {
    isSpeaking.value = value;
  }

  /** 切换连续对话模式 */
  function toggleContinuousMode() {
    continuousMode.value = !continuousMode.value;
  }

  return {
    status,
    sessionState,
    interimText,
    finalText,
    confidence,
    messages,
    isProcessing,
    isSpeaking,
    continuousMode,
    messageCount,
    setStatus,
    setSessionState,
    updateText,
    addUserMessage,
    addAssistantMessage,
    addSystemMessage,
    clearMessages,
    setProcessing,
    setSpeaking,
    toggleContinuousMode,
  };
});
