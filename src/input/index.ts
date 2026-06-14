/**
 * 统一输入处理层
 */

export { InputRouter } from './router'
export { IntentDetector } from './intent-detector'
export type { Phase1Detection } from './intent-detector'
export { InputPipeline } from './pipeline'
export { extractTags, isChatOnlyReply, getChatText } from './tag-parser'
export type { ExtractedTags } from './tag-parser'
export type {
  InputContext,
  InputResult,
  PipelineCallbacks,
} from './types'
