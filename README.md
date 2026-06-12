# AI 语音浏览器助手

支持语音控制 + 网页自动化 + 多模型切换的 AI 浏览器助手。

## ✨ 核心特性

- 🎤 **语音控制**：Web Speech API 语音识别，支持连续对话模式
- 🤖 **AI 对话**：多模型切换（OpenAI 兼容 / 通义千问 / 文心一言）
- 🌐 **网页自动化**：打开网站、全网搜索、站内搜索、点击结果
- 🔥 **热更新开发**：基于 WXT 框架，`npm run dev` 即时预览
- 📦 **一键打包**：`npm run build` 生成可安装的浏览器扩展

## 📁 项目结构

```
├── entrypoints/          # WXT 入口文件
│   ├── background.ts     # 后台 Service Worker
│   └── content/          # Content Script（Shadow DOM 注入）
│       ├── App.vue       # 主应用组件
│       └── components/   # UI 组件
│           ├── ChatDrawer.vue    # 主面板（文字/语音切换）
│           ├── ChatPanel.vue     # 文字对话面板
│           ├── VoicePanel.vue    # 语音控制面板
│           └── ...
├── src/
│   ├── voice/            # 语音识别模块
│   │   ├── recognition.ts    # SpeechRecognition 封装
│   │   └── commandParser.ts  # 语音指令解析
│   ├── automation/       # 网页自动化模块
│   │   ├── actions.ts        # 动作执行器
│   │   └── selectors.ts      # DOM 选择器
│   ├── adapters/         # AI 模型适配器
│   │   ├── openai.ts         # OpenAI 协议
│   │   ├── qwen.ts           # 通义千问
│   │   └── wenxin.ts         # 文心一言
│   ├── stores/           # Pinia 状态管理
│   │   ├── settings.ts       # 设置状态
│   │   ├── conversations.ts  # 会话状态
│   │   └── voice.ts          # 语音状态
│   └── types.ts          # TypeScript 类型定义
├── wxt.config.ts         # WXT 配置
└── package.json
```

## 🚀 快速开始

### 环境要求

- Node.js >= 20.19.0
- Chrome 或 Edge 浏览器

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

启动后会自动打开浏览器，加载扩展。修改代码后会自动热更新。

### 生产打包

```bash
npm run build
```

打包后的文件在 `.output/` 目录，可以直接加载到浏览器。

### 类型检查

```bash
npm run compile
```

## 🎤 语音指令

| 指令类型 | 示例 |
|---------|------|
| 打开网站 | 「打开B站」「打开淘宝」「打开知乎」 |
| 全网搜索 | 「搜索美食教程」「搜一下2026热门景点」 |
| 站内搜索 | 「站内搜索无线耳机」 |
| 点击结果 | 「打开第三个」「点击第五个」 |
| 翻页 | 「下一页」「上一页」 |
| 视频控制 | 「播放」「暂停」 |

## 🤖 支持的 AI 模型

| 模型 | Provider | 说明 |
|------|----------|------|
| OpenAI 兼容 | `openai` | GPT-3.5/4、Claude 等 |
| 通义千问 | `qwen` | 阿里云，国内首选 |
| 文心一言 | `wenxin` | 百度千帆平台 |

## ⚙️ 配置说明

### 模型配置

在扩展的设置面板中配置：

1. **Provider**：选择模型提供商
2. **Base URL**：API 请求地址
3. **API Key**：API 密钥
4. **Model Name**：模型名称

### 快捷键

- `Ctrl+Shift+M`：打开/关闭对话面板

## 🔧 技术栈

- **框架**：[WXT](https://wxt.dev) - 下一代浏览器扩展框架
- **前端**：Vue 3 + TypeScript + Pinia
- **构建**：Vite (WXT 内置)
- **语音**：Web Speech API (SpeechRecognition)
- **样式**：Shadow DOM 隔离，不污染宿主页面

## 📝 开发说明

### 添加新的 AI 模型

1. 在 `src/adapters/` 创建新的适配器文件
2. 继承 `BaseAdapter`，实现 `chat` 方法
3. 在 `src/adapters/index.ts` 注册新适配器
4. 在 `src/types.ts` 更新 `Provider` 类型

### 添加新的自动化动作

1. 在 `src/voice/commandParser.ts` 添加新的指令匹配规则
2. 在 `src/automation/actions.ts` 添加新的动作执行函数
3. 在 `src/automation/selectors.ts` 添加对应的 DOM 选择器

## 📄 License

MIT
