# 功能文档索引

AI 浏览器助手的功能文档，按模块划分，描述每个功能的用途、使用方式、参数和具体行为。

## 快速查找

| 我想... | 参考文档 |
|---------|---------|
| 用 AI 自动点击页面元素 | [browser-commands.md](./browser-commands.md) → click |
| 让 AI 帮我填表单 | [browser-commands.md](./browser-commands.md) → type + select |
| 控制页面上的视频 | [browser-commands.md](./browser-commands.md) → video |
| 让 AI 滚动页面 | [browser-commands.md](./browser-commands.md) → scroll |
| 让 AI 自动滚动页面 | [browser-commands.md](./browser-commands.md) → scroll (auto/stop/pause/resume) |
| 让 AI 打开新网页 | [browser-commands.md](./browser-commands.md) → navigate |
| 让 AI 操作键盘 | [browser-commands.md](./browser-commands.md) → keyboard / press |
| 管理多个标签页 | [browser-commands.md](./browser-commands.md) → newTab / closeTab / switchTab |
| 用 / 命令直接操作 | [input-system.md](./input-system.md) → 能力域指令 |
| 从页面提取数据下载 | [input-system.md](./input-system.md) → /download 命令 |
| 让 AI 分析总结页面 | [input-system.md](./input-system.md) → /summarize 命令 |
| 语音控制浏览器 | [voice-features.md](./voice-features.md) |
| 翻译选中的文本 | [translation-features.md](./translation-features.md) → 划词翻译 |
| 翻译整个页面 | [translation-features.md](./translation-features.md) → 自动翻译 |
| 点击一段文字翻译 | [translation-features.md](./translation-features.md) → 点击翻译 |
| 解析上传的 PDF 文件 | [file-features.md](./file-features.md) → 文件解析 |
| 让 AI 生成 Excel 文件 | [file-features.md](./file-features.md) → [FILE] 标签 |
| 对图片做 OCR 识别 | [file-features.md](./file-features.md) → OCR |
| 生成图表 | [file-features.md](./file-features.md) → ECharts 图表 |
| 配置新的 AI 模型 | [ai-providers.md](./ai-providers.md) |
| 用语音自动打开网站 | [automation-actions.md](./automation-actions.md) → open_site |
| 用语音搜索 | [automation-actions.md](./automation-actions.md) → search |

## 文档列表

| 文档 | 一句话摘要 |
|------|-----------|
| [browser-commands.md](./browser-commands.md) | 18 种浏览器操作（click/type/scroll/navigate/video/标签页/download/summarize 等），三重元素定位，自动滚动，编辑器输入支持 |
| [automation-actions.md](./automation-actions.md) | 8 种语音自动化操作，站点选择器适配，语音命令解析格式 |
| [input-system.md](./input-system.md) | 输入路由（/命令 + 能力域 + AI）、两阶段意图检测、Phase 2 流式执行、批量指令、数据提取与分析 |
| [ai-providers.md](./ai-providers.md) | 11 种 AI 提供商配置、双协议支持（OpenAI/Anthropic）、代理机制 |
| [voice-features.md](./voice-features.md) | 双引擎语音识别（Sherpa-ONNX + Web Speech API）、TTS 播报、语音会话状态机 |
| [file-features.md](./file-features.md) | 文件解析（7 种类型）、OCR、文件生成（5 种格式）、[FILE] 标签系统、ECharts 图表 |
| [translation-features.md](./translation-features.md) | 三种翻译模式（划词/自动/点击）、三层代码过滤、内联代码保留 |
