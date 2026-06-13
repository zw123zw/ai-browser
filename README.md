# AI 语音浏览器助手

支持语音控制 + 网页自动化 + 多模型切换的 AI 浏览器助手。

## ✨ 核心特性

- 🎤 **纯语音交互**：AI 驱动的语音会话，支持连续对话、多指令批量执行
- 🤖 **多模型切换**：OpenAI 兼容 / 通义千问 / 文心一言，流式输出
- 🌐 **网页自动化**：打开网站、全网搜索、站内搜索、点击结果、翻页、视频控制
- 🔥 **热更新开发**：基于 WXT 框架，`npm run dev` 即时预览
- 📦 **一键打包**：`npm run build` 生成可安装的浏览器扩展
- 🛡️ **Shadow DOM 隔离**：UI 注入不污染宿主页面
- 📝 **全局日志系统**：分级日志，便于调试追踪

## 🏗️ 项目架构

```
ai-browser/
├── entrypoints/                    # WXT 入口文件
│   ├── background.ts               # 后台 Service Worker
│   └── content/                    # Content Script（Shadow DOM 注入）
│       ├── index.ts                # 入口：创建 Shadow Root，挂载 Vue
│       ├── App.vue                 # 根组件：快捷键、主题、抽屉控制
│       └── components/
│           ├── ChatDrawer.vue      # 主抽屉（文字/语音切换）
│           ├── ChatPanel.vue       # 文字对话面板
│           ├── VoicePanel.vue      # 语音控制面板（麦克风 + 消息流）
│           ├── FloatingButton.vue  # 悬浮按钮
│           ├── SettingsModal.vue   # 设置弹窗
│           ├── InputBar.vue        # 输入框组件
│           ├── MessageList.vue     # 消息列表
│           ├── MessageItem.vue     # 单条消息
│           └── ...
├── src/
│   ├── voice/                      # 🎤 语音交互模块（核心）
│   │   ├── index.ts                # 模块导出
│   │   ├── recognition.ts          # Web Speech API 封装
│   │   ├── session.ts              # 语音会话状态机（AI 驱动）
│   │   ├── commandParser.ts        # 【code】指令解析器
│   │   └── broadcast.ts            # 语音播报（TTS）
│   ├── automation/                 # 🌐 网页自动化模块
│   │   ├── index.ts                # 模块导出
│   │   ├── actions.ts              # 动作执行器（8 种指令）
│   │   └── selectors.ts            # DOM 选择器集合
│   ├── adapters/                   # 🤖 AI 模型适配器
│   │   ├── index.ts                # 适配器工厂
│   │   ├── base.ts                 # 基类
│   │   ├── openai.ts               # OpenAI 协议（GPT/Claude/...）
│   │   ├── qwen.ts                 # 通义千问
│   │   └── wenxin.ts               # 文心一言
│   ├── stores/                     # 📦 Pinia 状态管理
│   │   ├── settings.ts             # 全局设置
│   │   ├── conversations.ts        # 文字会话
│   │   └── voice.ts                # 语音状态（4 状态机）
│   ├── utils/                      # 🔧 工具函数
│   │   ├── logger.ts               # 统一日志系统
│   │   ├── markdown.ts             # Markdown 渲染
│   │   ├── shortcut.ts             # 快捷键匹配
│   │   ├── file.ts                 # 文件工具
│   │   └── storage-sync.ts         # 存储同步
│   ├── composables/                # Vue 组合式函数
│   │   └── useToast.ts             # Toast 提示
│   ├── storage/                    # 存储抽象层
│   │   └── index.ts
│   └── types.ts                    # TypeScript 类型定义
├── wxt.config.ts                   # WXT 配置
├── tsconfig.json                   # TypeScript 配置
└── package.json
```

## 🔄 语音交互流程

```
用户说话 → VoiceRecognition (Web Speech API)
    ↓
识别文本 → VoiceSession.handleResult()
    ↓
发送给 AI → callAI() 流式请求
    ↓
AI 返回 【code】 指令 → parseBatchCommand() 解析
    ↓
串行执行 → executeAutomationAction() 注入 content script
    ↓
语音播报结果 → VoiceBroadcast (TTS)
    ↓
回到 IDLE 等待下一轮
```

## 🎤 语音指令

| 指令类型 | 示例 | 说明 |
|---------|------|------|
| 打开网站 | 「打开B站」「打开淘宝」 | 自动补全 https:// |
| 全网搜索 | 「搜索美食教程」 | 默认百度搜索 |
| 站内搜索 | 「站内搜索无线耳机」 | 查找页面搜索框 |
| 点击结果 | 「打开第三个」「点击第五个」 | 按序号点击 |
| 翻页 | 「下一页」「上一页」 | 自动查找翻页按钮 |
| 视频控制 | 「播放」「暂停」 | 控制页面视频 |
| 批量指令 | 「打开B站搜索美食教程」 | AI 自动拆分多条指令 |

## 🤖 支持的 AI 模型

### 国内模型（推荐）

| 模型 | Provider | Base URL |
|------|----------|----------|
| 通义千问 | `qwen` | https://dashscope.aliyuncs.com/api/v1 |
| 智谱 ChatGLM | `zhipu` | https://open.bigmodel.cn/api/paas/v4 |
| DeepSeek | `deepseek` | https://api.deepseek.com/v1 |
| Moonshot (Kimi) | `moonshot` | https://api.moonshot.cn/v1 |
| 百川智能 | `baichuan` | https://api.baichuan-ai.com/v1 |
| 零一万物 | `yi` | https://api.lingyiwanwu.com/v1 |
| 讯飞星火 | `spark` | https://spark-api-open.xf-yun.com/v1 |
| Minimax | `mino` | https://api.minimax.chat/v1 |
| 文心一言 | `wenxin` | https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop |

### 国外模型

| 模型 | Provider | Base URL |
|------|----------|----------|
| OpenAI | `openai` | https://api.openai.com/v1 |
| Anthropic Claude | `anthropic` | https://api.anthropic.com/v1 |
| Google Gemini | `gemini` | https://generativelanguage.googleapis.com/v1beta |

## ⚙️ 配置说明

在扩展的设置面板中配置：

1. **Provider**：选择模型提供商
2. **Base URL**：API 请求地址
3. **API Key**：API 密钥
4. **Model Name**：模型名称

### 快捷键

- `Ctrl+Shift+M`：打开/关闭对话面板（可自定义）

## 📄 License

MIT
