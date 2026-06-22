# AI 适配器配置与能力参考

统一多 AI 提供者的协议差异，提供一致的流式对话接口。

## 功能总览

| 功能 | 说明 |
|------|------|
| 多提供商支持 | 11 种 AI 提供商，统一 `chat()` 接口 |
| 流式输出 | SSE 实时逐字显示 |
| 深度思考 | 支持 reasoning/thinking 内容展示 |
| 后台代理 | CORS 规避，流式 chunk 转发 |
| 自定义提供商 | 支持任意 OpenAI 兼容 API |

---

## 支持的 Provider 列表

| Provider | 适配器类 | API 格式 | 认证方式 | 特殊能力 |
|----------|---------|---------|---------|---------|
| openai | OpenAIAdapter | OpenAI Chat Completions | Bearer token | — |
| anthropic | OpenAIAdapter | Anthropic Messages | x-api-key | thinking delta |
| gemini | GeminiAdapter | Google Generative Language | x-goog-api-key | systemInstruction, thought parts |
| qwen | QwenAdapter | DashScope | Bearer token | 独立 system 字段 |
| wenxin | WenxinAdapter | 百度独立协议 | 无（内部 token） | result 字段, is_end |
| doubao | DoubaoAdapter | OpenAI 兼容 | Bearer token | endpoint_id |
| zhipu | OpenAIAdapter | OpenAI 兼容 | Bearer token | — |
| deepseek | OpenAIAdapter | OpenAI 兼容 | Bearer token | — |
| moonshot | OpenAIAdapter | OpenAI 兼容 | Bearer token | — |
| grok | OpenAIAdapter | OpenAI 兼容 | Bearer token | — |
| custom | OpenAIAdapter | OpenAI 兼容 | Bearer token | 自定义 baseUrl |

**工厂函数：** `createAdapter(provider)` 根据 provider 类型返回对应适配器实例。大多数供应商使用 OpenAI 兼容协议，只有 Gemini、文心一言、豆包、通义千问需要独立适配器。

---

## 各 Provider 差异

### Anthropic (Claude)

- **URL：** `/v1/messages`（非 `/v1/chat/completions`）
- **请求体：** system 消息提取到顶层 `system` 字段
- **响应解析：** `content_block_delta` 事件，`delta.type === 'text_delta'`
- **思考内容：** `delta.type === 'thinking_delta'`（Claude 3.7+）
- **认证：** `x-api-key` header + `anthropic-version: 2023-06-01`
- **URL 检测：** `provider === 'anthropic'` 或 URL 包含 `/anthropic`

### Gemini

- **URL：** `/v1beta/models/{model}:streamGenerateContent?alt=sse`
- **请求体：** `systemInstruction` 字段替代 system role，`contents` 格式
- **响应解析：** `candidates[0].content.parts[]` 结构
- **思考内容：** `part.thought === true`（Gemini 2.0+ thinking model）
- **认证：** `x-goog-api-key` header

### 文心一言 (Wenxin)

- **URL：** `/chat/completions`
- **响应：** `result` 字段（非 choices），`is_end` 标志结束
- **错误处理：** `error_code` + `error_msg` 字段

### 通义千问 (Qwen)

- **URL：** `/services/aigc/text-generation/generation`
- **请求体：** `input.messages` + `input.system`（独立 system 字段）
- **参数：** `result_format: 'message'`, `incremental_output: true`

### 豆包 (Doubao)

- **URL：** 包含 `endpoint_id` 路径段
- **其他：** OpenAI 兼容

---

## 代理机制

所有 API 请求通过 `proxyFetchStream()` 经 background Service Worker 中转，规避 CORS 限制。

**流程：**

1. Content Script 发送 `proxy-fetch-stream` 消息到 Background
2. Background 执行 `fetch()`，获取 `ReadableStream`
3. Background 生成 `requestId`，存入 `activeStreams` Map
4. 逐块读取流数据，通过 `chrome.tabs.sendMessage` 转发 `stream-chunk`
5. Content Script 通过 `chunkListener` 接收数据，回调 `onChunk()`
6. 流结束时发送 `stream-end`，异常时发送 `stream-error`

**中止：** Content Script 发送 `abort-stream` 消息，Background 调用 `reader.cancel()` 并从 `activeStreams` 移除。

**回退机制：** 如果 `chrome.runtime` 不可用（如 Side Panel 中），自动降级为 `fetch()` 直连。

---

## 深度思考（Reasoning）

部分模型支持深度思考，返回额外的 reasoning 内容：

| Provider | 字段 | 说明 |
|----------|------|------|
| OpenAI | `reasoning_content` | delta 中的推理内容 |
| Anthropic | `thinking_delta` | thinking content block |
| Gemini | `part.thought` | thought 标记的 parts |

---

## 默认模型配置

开箱即用的模型通过 `local-config.json` 配置，构建时导入：

```json
[
  {
    "id": "mimo-v2.5",
    "label": "mimo-v2.5",
    "modelName": "mimo-v2.5",
    "provider": "anthropic",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/anthropic"
  }
]
```

`parseLocalModels()` 处理逻辑：
- `baseUrl` 末尾去掉 `/chat/completions`（适配器会自动拼接）
- `provider` 默认为 `'openai'`
- `label` 默认等于 `modelName`

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 代理回退 | `proxyFetchStream()` 失败时自动降级为 `fetch()` 直连 |
| HTTP 错误 | 尝试从响应体 JSON 中提取 `error.message` |
| 中止支持 | 所有适配器通过 `AbortSignal` 支持请求取消 |
| 流异常 | `parseSSE()` 中读取流失败时抛出异常 |
| JSON 容错 | chunk 解析均包裹在 try-catch 中，单条畸形数据不影响后续 |
| 百度 token 错误 | HTTP 200 但响应体包含错误码时，抛出异常 |
