/**
 * 提示词模块 — 桶导出
 *
 * 所有消费方的 import 路径不变：
 *   import { ... } from '@/src/input/prompts'
 *   import { ... } from './prompts'
 */

// 共享常量
export {
  type CapabilityItem,
  CAPABILITY_DOMAIN_LIST,
  CAPABILITY_LIST,
  PHASE1_CAPABILITY_LIST,
  FILE_FORMAT_RULES,
  SITE_URL_RULE,
  FILE_EXT_RULE,
  COMMAND_CLOSE_RULE,
} from './common'

// Phase 1
export {
  PHASE1_SYSTEM_PROMPT,
  buildPhase1Prompt,
} from './phase1'

// Phase 2
export {
  PHASE2_SYSTEM_PROMPT,
  MODE_FIRST,
  MODE_STREAMING,
  MODE_RETRY,
  buildPhase2Prompt,
  buildPhase2UserMessage,
  buildStreamingUserMessage,
} from './phase2'

// 翻译
export {
  TRANSLATE_SYSTEM_PROMPT,
  buildSelectionTranslateMessage,
  buildAutoTranslateMessage,
} from './translate'

// 数据提取
export {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractPrompt,
} from './extract'

// 分析总结
export {
  SUMMARIZE_SYSTEM_PROMPT,
  buildSummarizePrompt,
} from './summarize'
