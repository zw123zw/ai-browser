# PRD：中转保护 + JS 混淆 + 国内外双分发

## 1. 背景与目标

### 1.1 背景

当前项目（AI 浏览器助手）需要商业化分发，面临以下问题：

- **技术泄露风险**：直接调用 AI API 时，prompt 模板和 API Key 在网络请求中明文暴露，任何人打开 DevTools 即可看到
- **国内外分发差异**：国内用户无法访问 Chrome 商店，海外用户习惯从商店安装
- **语音识别方案**：Web Speech API 依赖 Google 服务（国内不可用），Sherpa-ONNX 模型文件过大（100-200MB）
- **商业化需求**：需要支持免费增值模式，通过激活码收费

### 1.2 目标

1. **核心逻辑零泄露**：prompt 模板、API Key、指令解析逻辑对用户完全不可见
2. **国内外全覆盖**：海外走 Chrome 商店，国内走 .zip 自分发
3. **语音双引擎**：海外用 Web Speech API（免费），国内用讯飞 API（免费 5 万次/天）
4. **用户可自定义**：高级用户可填自己的 API Key，仍走中转保护 prompt
5. **零服务器成本**：Cloudflare Worker（免费 10 万次/天）+ 腾讯云函数（免费 100 万次/月）
6. **代码保护**：JS 混淆增加逆向难度

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────┐
│                  用户浏览器                        │
│  ┌───────────────────────────────────────────┐  │
│  │         扩展端（JS 混淆保护）                │  │
│  │  ├── UI（Vue 组件）                        │  │
│  │  ├── 语音录音                              │  │
│  │  │   ├── Web Speech API（海外）            │  │
│  │  │   └── 讯飞 WebSocket（国内）            │  │
│  │  ├── DOM 操作执行器（ActionExecutor）       │  │
│  │  └── proxy-client.ts ──────────────────┐  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                                               │
           ┌───────────────────────────────────┤
           │ 自动检测：国内 / 海外               │
           ▼                                   ▼
┌─────────────────────────┐      ┌──────────────────────────┐
│  腾讯云函数（国内）        │      │  Cloudflare Worker        │
│  ├── prompt 模板         │      │  （海外）                  │
│  ├── 指令解析逻辑        │      │  ├── prompt 模板          │
│  ├── 激活码验证          │      │  ├── 指令解析逻辑         │
│  ├── 讯飞 API Key       │      │  ├── 激活码验证           │
│  ├── 用户 Key 透传       │      │  ├── 用户 Key 透传        │
│  └── 调用 AI API ───────┼──┐   │  └── 调用 AI API ────────┼──┐
└─────────────────────────┘  │   └──────────────────────────┘  │
                             │                                  │
                             ▼                                  ▼
                       ┌──────────┐                      ┌──────────┐
                       │ AI 服务商 │                      │ AI 服务商 │
                       │（国内）   │                      │（海外）   │
                       └──────────┘                      └──────────┘
```

### 2.2 请求流程

```
用户输入（文字/语音）
    │
    ▼
扩展端 proxy-client.ts
    │
    ├─ 检测网络环境（2s 超时）
    │
    ├─ 海外可达 → Cloudflare Worker
    │              ├── 接收 { userText, userApiKey?, userModel?, systemPrompt? }
    │              ├── 拼接 prompt（用户看不到）
    │              ├── 用用户 Key 或默认 Key 调 AI
    │              └── 返回结果
    │
    └─ 海外不可达 → 腾讯云函数
                   └── 同上逻辑
```

---

## 3. 功能需求

### 3.1 中转服务（Cloudflare Worker + 腾讯云函数）

#### 3.1.1 API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/` (POST) | chat | 非流式 AI 聊天 |
| `/` (POST) | chat-stream | 流式 AI 聊天（SSE） |
| `/` (POST) | xfyun-token | 讯飞 WebSocket 鉴权 URL |
| `/` (POST) | verify | 激活码验证 |

#### 3.1.2 请求格式

```json
{
  "action": "chat",
  "data": {
    "userText": "用户输入的文本",
    "pageUrl": "https://example.com",
    "pageHtml": "页面HTML（可选）",
    "skeleton": {},
    "systemPrompt": "Phase1/Phase2 prompt（由扩展端指定）",
    "recentMessages": [{"role": "user", "content": "..."}],
    "userApiKey": "sk-xxx（用户自定义Key，可选）",
    "userModel": "gpt-4o（用户自定义模型，可选）"
  }
}
```

#### 3.1.3 响应格式

```json
// 非流式
{ "reply": "AI回复内容" }

// 流式（SSE）
data: {"delta": "你"}
data: {"delta": "好"}
data: [DONE]

// 讯飞鉴权
{ "url": "wss://ws-api.xfyun.cn/v2/iat?..." }

// 激活码验证
{ "valid": true, "message": "激活成功" }
```

#### 3.1.4 Prompt 存储

以下 prompt 从扩展端迁移到中转服务端：

| 原文件 | 服务端字段 |
|--------|-----------|
| `src/input/prompts/phase1.ts` | `CONFIG.PHASE1_PROMPT` |
| `src/input/prompts/phase2.ts` | `CONFIG.PHASE2_PROMPT` |
| `src/input/prompts/common.ts` | `CONFIG.CAPABILITY_LIST` |
| `src/voice/session.ts` | `CONFIG.VOICE_COMMAND_PROMPT` |

#### 3.1.5 用户自定义 Key 逻辑

```
if (data.userApiKey) {
  // 用用户的 Key 调 AI
  apiKey = data.userApiKey
  model = data.userModel || defaultModel
} else {
  // 用默认 Key 调 AI
  apiKey = CONFIG.AI_API_KEY
  model = CONFIG.AI_MODEL
}

// prompt 始终由服务端拼接（不管用谁的 Key）
messages = [
  { role: 'system', content: systemPrompt || CONFIG.DEFAULT_PROMPT },
  { role: 'user', content: userContent }
]
```

### 3.2 扩展端改造

#### 3.2.1 新增文件

**`src/utils/proxy-client.ts`** — 中转客户端

职责：
- 自动检测国内/海外环境
- 封装所有中转 API 调用
- 提供 `proxyChat`、`proxyChatStream`、`getXfyunToken`、`verifyLicense` 方法

关键逻辑：
```typescript
async function detectRegion(): Promise<'overseas' | 'domestic'> {
  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 2000)
    await fetch(PROXY_URLS.overseas, { method: 'OPTIONS', signal: controller.signal })
    return 'overseas'
  } catch {
    return 'domestic'
  }
}
```

#### 3.2.2 修改文件

**`src/input/intent-detector.ts`** — Phase 1/2 AI 调用改走中转

改前（第 151-259 行）：
```typescript
private async callAI(scene, systemPrompt, userContent, onChunk) {
  const adapter = createAdapter(model.provider || settings.provider)
  await adapter.chat({ baseUrl, apiKey, modelName, messages }, callback)
}
```

改后：
```typescript
private async callAI(scene, systemPrompt, userContent, onChunk) {
  if (onChunk) {
    return await proxyChatStream({
      userText: userContent,
      systemPrompt,
      recentMessages: this.options.getRecentMessages?.(),
      modelId: this.options.getModelId?.(),
    }, onChunk)
  } else {
    const result = await proxyChat({
      userText: userContent,
      systemPrompt,
      recentMessages: this.options.getRecentMessages?.(),
      modelId: this.options.getModelId?.(),
    })
    return result.reply
  }
}
```

**`src/input/pipeline.ts`** — Phase 2 流式 AI 调用改走中转

改前（第 853-955 行）：
```typescript
private async callStreamingAI(...) {
  const adapter = createAdapter(...)
  await adapter.chat({ ... }, callback)
  const tags = extractTags(fullResponse)
  return { commands, needFull, rawAiOutput }
}
```

改后：
```typescript
private async callStreamingAI(...) {
  let fullResponse = ''
  await proxyChatStream({
    userText: userContent,
    skeleton,
    systemPrompt,
    recentMessages,
    modelId,
  }, (delta) => { fullResponse += delta })

  // 标签解析保留客户端（need_full/need_input 是流程控制）
  const tags = extractTags(fullResponse)
  return { commands: tags.commands, needFull: tags.needFull, needInput: tags.needInput, rawAiOutput: fullResponse }
}
```

**`src/voice/voice-manager.ts`** — 讯飞鉴权走中转

改前（第 191-206 行）：
```typescript
import('./engines/iflytek-engine').then(({ IflytekEngine }) => {
  this.engine = new IflytekEngine(this.config.iflytekConfig!, { ... })
})
```

改后：
```typescript
import { getXfyunToken } from '@/src/utils/proxy-client'

const { url } = await getXfyunToken()
this.engine = new IflytekEngine({ wsUrl: url }, { ... })
```

**`src/stores/voice.ts`** — 删除讯飞 Key 配置

改前：
```typescript
iflytekApiKey: string
iflytekAppId: string
```

改后：删除这两个字段（Key 存在中转服务端）

**`wxt.config.ts`** — 添加 JS 混淆

```typescript
import JavaScriptObfuscator from 'webpack-obfuscator'

export default defineConfig({
  vite: () => ({
    esbuild: { charset: 'ascii' },
    build: { cssMinify: 'esbuild' },
    plugins: [
      process.env.NODE_ENV === 'production'
        ? JavaScriptObfuscator({
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            stringArray: true,
            stringArrayEncoding: ['rc4'],
            stringArrayThreshold: 0.75,
            transformObjectKeys: true,
          })
        : null,
    ].filter(Boolean),
  }),
  manifest: {
    host_permissions: [
      '<all_urls>',
      'https://*.workers.dev/*',
      'https://*.myqcloud.com/*',
    ],
  },
})
```

**`package.json`** — 添加依赖和脚本

```json
{
  "scripts": {
    "build:overseas": "bash -c \"wxt build --mode overseas\"",
    "build:domestic": "bash -c \"wxt build --mode domestic\"",
    "build:all": "npm run build:overseas && npm run build:domestic"
  },
  "devDependencies": {
    "javascript-obfuscator": "^4.1.1",
    "webpack-obfuscator": "^3.5.1"
  }
}
```

### 3.3 语音识别方案

| 环境 | 引擎 | 说明 |
|------|------|------|
| 海外（Chrome 商店版） | Web Speech API | 浏览器内置，免费，Google 服务 |
| 国内（.zip 分发版） | 讯飞 API | 免费 5 万次/天，中文识别率最高 |

切换逻辑：
- 扩展端通过环境变量 `VITE_VOICE_ENGINE` 决定默认引擎
- 用户可在设置中手动切换
- 讯飞鉴权 URL 从中转服务获取（Key 不暴露）

### 3.4 激活码系统

#### 3.4.1 激活码格式

```
AIB-XXXX-XXXX-XXXX
├── AIB：固定前缀
├── XXXX：4 位大写字母+数字
└── 校验：最后 2 位是校验码
```

#### 3.4.2 验证逻辑（服务端）

```javascript
function verifyLicense(code) {
  if (!/^AIB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    return { valid: false, message: '激活码格式错误' }
  }
  const parts = code.split('-').slice(1)
  const hash = simpleHash(parts.join('') + CONFIG.LICENSE_SECRET)
  const valid = hash % 97 === parseInt(parts[2].slice(-2), 36) % 97
  return { valid, message: valid ? '激活成功' : '激活码无效' }
}
```

#### 3.4.3 免费版/付费版区分

| 功能 | 免费版 | 付费版（¥39/月） |
|------|--------|----------------|
| 文字指令 | 每天 10 次 | 无限 |
| 语音控制 | ❌ | ✅ |
| 多步骤任务 | ❌ | ✅ |
| 激活码 | 不需要 | 需要输入 |

### 3.5 分发方案

#### 3.5.1 海外版（Chrome 商店）

- 语音引擎：Web Speech API（默认）
- 中转地址：Cloudflare Worker
- 收款：Gumroad（邮箱注册，不需要信用卡）
- 隐私政策：Neocities（免费）

#### 3.5.2 国内版（.zip 自分发）

- 语音引擎：讯飞 API（默认）
- 中转地址：腾讯云函数
- 分发渠道：蓝奏云 + free3v + 吾爱破解
- 收款：爱发电（支付宝收款，自动发激活码）

#### 3.5.3 环境变量

`.env.overseas`：
```
VITE_PROXY_URL_OVERSEAS=https://ai-browser-proxy.xxx.workers.dev
VITE_PROXY_URL_DOMESTIC=https://xxx.ap-guangzhou.myqcloud.com
VITE_REGION=overseas
VITE_VOICE_ENGINE=web-speech
```

`.env.domestic`：
```
VITE_PROXY_URL_OVERSEAS=https://ai-browser-proxy.xxx.workers.dev
VITE_PROXY_URL_DOMESTIC=https://xxx.ap-guangzhou.myqcloud.com
VITE_REGION=domestic
VITE_VOICE_ENGINE=iflytek
```

---

## 4. 文件变更清单

### 4.1 新增文件（5 个）

| 文件 | 用途 |
|------|------|
| `src/utils/proxy-client.ts` | 中转 API 客户端 |
| `workers/ai-proxy.js` | Cloudflare Worker 代码 |
| `tencent-scf/index.js` | 腾讯云函数代码 |
| `.env.domestic` | 国内版环境变量 |
| `.env.overseas` | 海外版环境变量 |

### 4.2 修改文件（6 个）

| 文件 | 改动内容 |
|------|---------|
| `src/input/intent-detector.ts` | `callAI` 方法改走 `proxyChat`/`proxyChatStream` |
| `src/input/pipeline.ts` | `callStreamingAI` 方法改走 `proxyChatStream` |
| `src/voice/voice-manager.ts` | 讯飞鉴权改走 `getXfyunToken` |
| `src/stores/voice.ts` | 删除 `iflytekApiKey`/`iflytekAppId` 字段 |
| `wxt.config.ts` | 添加 JS 混淆插件 + host_permissions |
| `package.json` | 添加 `javascript-obfuscator` 依赖 + 打包脚本 |

### 4.3 不修改的文件

| 文件 | 原因 |
|------|------|
| 所有 Vue 组件 | UI 层，不需要改 |
| `src/browser/action-executor.ts` | DOM 操作，不需要改 |
| `src/browser/skeleton.ts` | 骨架提取，不需要改 |
| `src/voice/web-speech-engine.ts` | 纯浏览器 API |
| `src/voice/broadcast.ts` | TTS 播报 |
| `src/voice/wake-word.ts` | 唤醒词检测 |
| `src/input/tag-parser.ts` | 标签解析保留客户端 |
| `src/input/prompts/*.ts` | 保留客户端（中转也有副本，用于无 systemPrompt 时的默认值） |
| `src/adapters/*.ts` | 保留（用户自定义 Key 直连模式需要） |

---

## 5. 实施计划

### 第 1 天：中转服务部署

1. 创建 `src/utils/proxy-client.ts`
2. 创建 `workers/ai-proxy.js`（迁移 prompt）
3. 注册 Cloudflare，部署 Worker，拿到地址
4. 创建 `tencent-scf/index.js`（复制 Worker 逻辑）
5. 注册腾讯云，部署云函数，拿到地址

### 第 2 天：扩展端改造

1. 修改 `src/input/intent-detector.ts`（callAI 走中转）
2. 修改 `src/input/pipeline.ts`（callStreamingAI 走中转）
3. 修改 `src/voice/voice-manager.ts`（讯飞鉴权走中转）
4. 修改 `src/stores/voice.ts`（删除 Key 配置）
5. 创建 `.env.domestic` 和 `.env.overseas`

### 第 3 天：JS 混淆 + 打包

1. 安装 `javascript-obfuscator` + `webpack-obfuscator`
2. 修改 `wxt.config.ts`
3. 修改 `package.json`（添加脚本）
4. 测试海外版打包（`npm run build:overseas`）
5. 测试国内版打包（`npm run build:domestic`）

### 第 4 天：测试

1. 测试海外版：Web Speech API + Cloudflare Worker
2. 测试国内版：讯飞 API + 腾讯云函数
3. 测试 prompt 不在 Network 面板暴露
4. 测试激活码验证
5. 测试用户自定义 Key 走中转

### 第 5 天：上架

1. Chrome 商店上传海外版（$5 注册费）
2. 蓝奏云上传国内版
3. free3v 做下载页
4. 吾爱破解发帖
5. 爱发电上架激活码

---

## 6. 成本

| 项目 | 费用 |
|------|------|
| Cloudflare Worker | 免费（10 万次/天） |
| 腾讯云函数 | 免费（100 万次/月） |
| Chrome 商店注册 | $5（一次性，约 ¥36） |
| 讯飞语音 API | 免费（5 万次/天） |
| Web Speech API | 免费（浏览器内置） |
| 蓝奏云 | 免费 |
| free3v | 免费 |
| Gumroad | 免费（抽成 10%） |
| 爱发电 | 免费（抽成 5-6%） |
| **总计** | **¥36（一次性）** |

---

## 7. 验收标准

- [ ] 打开 DevTools → Network → 发送消息 → 请求体里没有 prompt
- [ ] 请求体只有 `{ action: "chat", data: { userText: "..." } }`
- [ ] API Key 不在任何请求里出现
- [ ] 海外版自动连接 Cloudflare Worker
- [ ] 国内版自动连接腾讯云函数
- [ ] JS 混淆后代码可读性极低
- [ ] 激活码验证正常工作
- [ ] Web Speech API 语音识别正常（海外版）
- [ ] 讯飞 API 语音识别正常（国内版）
- [ ] 用户自定义 Key 走中转正常
- [ ] Chrome 商店审核通过（海外版）
- [ ] .zip 国内版可正常安装使用

---

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Cloudflare Worker 国内访问慢 | 国内用户体验差 | 自动降级到腾讯云函数 |
| 腾讯云函数需要实名 | 泄露身份 | 用家人身份注册 |
| Chrome 商店审核拒绝 | 海外无法分发 | 修改后重新提交 |
| 讯飞免费额度用完 | 语音不可用 | 用户可切换 Web Speech API |
| JS 混淆被逆向 | 核心逻辑泄露 | 混淆只是增加难度，prompt 在服务端才是真正的保护 |
