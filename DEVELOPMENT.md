# 开发指南

本文档包含项目的环境要求、技术栈、安装启动、打包发布、本地调试等完整开发流程。

---

## 📋 环境要求

### 必需环境

| 环境 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | >= 20.19.0 | 推荐使用 nvm 管理版本 |
| **npm** | >= 10.x | 随 Node.js 安装 |
| **Chrome** | >= 116 | 或 Edge >= 116，支持 Manifest V3 |
| **Git** | 任意版本 | 版本控制 |

### 可选环境

| 环境 | 用途 |
|------|------|
| **VS Code** | 推荐编辑器，安装 Vue - Official 插件 |
| **Firefox** | >= 109，用于 Firefox 扩展开发 |

---

## 🛠️ 技术栈

### 核心框架

| 技术 | 版本 | 用途 |
|------|------|------|
| **WXT** | ^0.19.21 | 下一代浏览器扩展框架，内置 Vite |
| **Vue 3** | ^3.5.13 | 前端 UI 框架，Composition API |
| **TypeScript** | ^5.7.2 | 类型安全 |
| **Pinia** | ^2.3.0 | 状态管理 |

### 语音相关

| 技术 | 用途 |
|------|------|
| **Web Speech API** | 语音识别（SpeechRecognition） |
| **SpeechSynthesis API** | 语音播报（TTS） |

### UI & 渲染

| 技术 | 用途 |
|------|------|
| **Shadow DOM** | 样式隔离，不污染宿主页面 |
| **markdown-it** | Markdown 渲染 |
| **highlight.js** | 代码高亮 |
| **KaTeX** | 数学公式渲染 |

### 构建工具

| 工具 | 用途 |
|------|------|
| **Vite** | WXT 内置，开发服务器 + 打包 |
| **esbuild** | TypeScript 编译、CSS 压缩 |
| **vue-tsc** | Vue + TypeScript 类型检查 |

---

## 🚀 安装与启动

### 1. 克隆项目

```bash
git clone https://github.com/zwf1110/browser-ai-chat.git
cd browser-ai-chat
```

### 2. 安装依赖

```bash
npm install
```

安装完成后会自动执行 `wxt prepare`，生成 `.wxt/` 类型声明目录。

### 3. 启动开发模式

```bash
npm run dev
```

**启动后会发生什么：**

1. WXT 编译项目，启动 Vite 开发服务器
2. 自动打开 Chrome 浏览器，加载扩展
3. 扩展图标出现在工具栏
4. 修改代码后自动热更新（HMR）

### 4. 访问扩展

- 点击工具栏扩展图标
- 或按快捷键 `Ctrl+Shift+M`
- 页面右下角出现悬浮按钮，点击打开对话面板

---

## 📦 打包与发布

### 生产打包

```bash
npm run build
```

**输出目录：** `.output/ai-voice-browser-assistant-chrome/`

打包后的扩展可以直接加载到 Chrome：

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `.output/` 目录

### 生成 ZIP 包

```bash
npm run zip
```

输出 `.zip` 文件，可直接上传到 Chrome Web Store。

### Firefox 打包

```bash
npm run build:firefox
npm run zip  # 或 wxt zip -b firefox
```

---

## 🔧 本地调试

### Content Script 调试

Content Script 运行在网页的 Shadow DOM 中：

1. 打开任意网页
2. 按 `F12` 打开 DevTools
3. 在 Elements 面板找到 `<browser-ai-chat>` 自定义元素
4. 展开 Shadow Root 查看组件结构
5. 在 Console 面板查看 `[Voice]`、`[Session]` 等前缀日志

### Background Service Worker 调试

1. 打开 `chrome://extensions/`
2. 找到「AI 语音浏览器助手」
3. 点击「Service Worker」链接
4. 打开 DevTools 查看 `[Background]` 前缀日志

### 快捷键调试

- `Ctrl+Shift+M`：打开/关闭对话面板
- 可在设置中自定义快捷键

### 日志系统

项目内置统一日志系统，输出格式：

```
[14:32:05] [INFO] [Voice] 识别完成 { text: "打开B站", confidence: 0.92 }
```

**日志级别：** DEBUG < INFO < WARN < ERROR

**主要模块日志前缀：**

| 前缀 | 模块 |
|------|------|
| `[VoiceRecognition]` | 语音识别 |
| `[Session]` | 语音会话状态机 |
| `[CommandParser]` | 指令解析 |
| `[Automation]` | 自动化执行 |
| `[Background]` | 后台服务 |
| `[Voice]` | 语音面板 |

### 常见问题排查

#### 麦克风无权限

- Chrome 要求 HTTPS 或 localhost 才能使用麦克风
- 检查浏览器设置 → 隐私 → 网站设置 → 麦克风

#### 语音识别不工作

- 确认使用 Chrome 或 Edge 浏览器
- 检查系统麦克风是否正常
- 查看 Console 是否有错误日志

#### 扩展加载失败

- 确认 Node.js 版本 >= 20.19.0
- 删除 `node_modules` 重新 `npm install`
- 检查 `.wxt/` 目录是否生成

---

## 🧪 类型检查

```bash
npm run compile
```

使用 `vue-tsc` 进行全项目 TypeScript 类型检查，确保无类型错误。

---

## 📝 开发规范

### 添加新的 AI 模型

1. 在 `src/adapters/` 创建新适配器文件
2. 继承 `BaseAdapter`，实现 `chat` 方法
3. 在 `src/adapters/index.ts` 注册
4. 在 `src/types.ts` 更新 `Provider` 类型

### 添加新的语音指令

1. 在 `src/voice/session.ts` 的 `COMMAND_SYSTEM_PROMPT` 添加指令说明
2. 在 `src/voice/commandParser.ts` 的 `VALID_TYPES` 添加类型
3. 在 `src/automation/actions.ts` 添加执行函数
4. 在 `src/automation/selectors.ts` 添加 DOM 选择器（如需要）

### 组件开发规范

- 使用 `<script setup lang="ts">` 语法
- 样式使用 `scoped`，类名以 `aib-` 前缀
- 状态管理使用 Pinia，不使用 Options API
- 工具函数放在 `src/utils/`，组合式函数放在 `src/composables/`

---

## 🎤 语音识别配置

本项目使用 **Sherpa-onnx** 进行本地语音识别：

- ✅ 完全离线运行，不需要网络
- ✅ 中文识别准确率 90-95%
- ✅ 一次下载，永久使用
- ✅ 隐私安全，数据不出本地

### 下载模型（首次使用）

**Windows：**
```bash
scripts\download-model.bat
```

**Linux/Mac：**
```bash
npm run download-model
```

**手动下载：**
1. 访问：https://github.com/k2-fsa/sherpa-onnx/releases
2. 下载：`sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2`
3. 解压到 `public/models/` 目录

### 模型文件结构

```
public/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
├── encoder-epoch-99-avg-1.int8.onnx
├── decoder-epoch-99-avg-1.onnx
├── joiner-epoch-99-avg-1.int8.onnx
├── tokens.txt
└── ...
```

详细说明见：[sherpa-onnx-setup.md](./docs/sherpa-onnx-setup.md)

## 📚 相关文档

- [WXT 官方文档](https://wxt.dev)
- [Vue 3 文档](https://vuejs.org)
- [Chrome 扩展文档](https://developer.chrome.com/docs/extensions)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
