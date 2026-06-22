# 输入系统功能参考

用户输入经过确定性路由、两阶段 AI 意图检测、流式指令执行，最终完成浏览器操作或返回聊天回复。

## 功能总览

| 功能 | 用途 | 触发方式 |
|------|------|---------|
| 内置命令 | 快速控制（停止/暂停/恢复等） | `/stop`, `/help` 等 |
| 能力域指令 | 直接执行浏览器操作 | `/scroll`, `/navigate` 等 |
| AI 聊天 | 自然语言对话 | 直接输入文本 |
| AI 操作 | 让 AI 操作页面 | 描述操作意图 |
| Phase 1 快速通道 | 简单操作直接执行（无需骨架） | 描述简单操作 |
| 数据提取 | 从页面提取数据生成文件 | `/download` 或自然语言 |
| 页面分析 | 分析总结页面内容 | `/summarize` 或自然语言 |
| 批量操作 | 批量执行相同操作 | 描述批量需求 |
| 用户输入请求 | AI 请求用户提供凭据等信息 | AI 自动触发 |

---

## 路由规则

| 输入前缀 | 路由目标 | 示例 |
|---------|---------|------|
| `/` + 内置命令名 | 内置命令 | `/stop`, `/help` |
| `/` + 能力域 ID | 能力域指令 | `/scroll auto`, `/navigate https://bilibili.com` |
| 其他 | AI 意图检测 | 任意自然语言 |

### 内置命令

| 命令 | 用途 |
|------|------|
| `/stop` | 停止当前操作 |
| `/pause` | 暂停执行 |
| `/resume` | 恢复执行 |
| `/list` | 列出可用命令 |
| `/help` | 显示帮助 |

### 能力域指令（18 种）

直接映射到 `CAPABILITY_DOMAIN_LIST` 中的 ID，跳过 Phase 1，直接进入 Phase 2：

| 指令 | 需要骨架 | 示例 |
|------|---------|------|
| `/navigate` | 否 | `/navigate https://bilibili.com` |
| `/scroll` | 否 | `/scroll auto`, `/scroll down`, `/scroll stop` |
| `/newTab` | 否 | `/newTab` |
| `/closeTab` | 否 | `/closeTab` |
| `/nextTab` | 否 | `/nextTab` |
| `/prevTab` | 否 | `/prevTab` |
| `/switchTab` | 否 | `/switchTab bilibili` |
| `/keyboard` | 否 | `/keyboard Enter` |
| `/wait` | 否 | `/wait 2000` |
| `/search` | 是 | `/search 猫咪视频` |
| `/click` | 是 | `/click 登录按钮` |
| `/type` | 是 | `/type hello` |
| `/clear` | 是 | `/clear` |
| `/select` | 是 | `/select 北京` |
| `/focus` | 是 | `/focus` |
| `/hover` | 是 | `/hover 菜单` |
| `/download` | 是 | `/download 提取商品名称和价格` |
| `/summarize` | 是 | `/summarize 分析这个页面` |

---

## 两阶段 AI 处理

### Phase 1 — 意图分类（轻量模型）

**输入：** 用户文本 + 历史上下文（最近 N 条消息，maxContext 限制）

**输出四种格式：**

| 格式 | 含义 | 后续处理 |
|------|------|---------|
| `[command]{...}[/command]` | 快速命令 | 直接执行（跳过 Phase 2） |
| `[action]` | 需要页面操作 | 进入 Phase 2 |
| `[FILE:xxx]...[/FILE]` | 文件生成请求 | 返回原始文本，前端渲染为文件卡片 |
| 直接回复 | 纯聊天 | 显示回复 |

**Phase 1 快速通道：**

Phase 1 直出 `[command]` 时跳过 Phase 2，直接执行。适用于不需要页面骨架的简单操作：

- `navigate` — 打开网页
- `scroll` — 滚动页面
- `keyboard`/`press` — 键盘按键
- `newTab`/`closeTab`/`switchTab`/`nextTab`/`prevTab` — 标签页操作
- `wait` — 等待

**自动化关闭时：** Phase 1 退化为二选一：`[FILE:xxx]` 或直接回复（不支持 [command]/[action]）。

### Phase 2 — 操作决策（主力模型）

**输入：** 用户文本 + 页面骨架 + 已完成步骤 + 错误信息

**输出三种格式：**

| 格式 | 含义 | 后续处理 |
|------|------|---------|
| `[command]{...}[/command]` | 执行命令 | 执行后刷新骨架，请求下一条 |
| `[need_full]` | 请求全页骨架 | 提取全页骨架后重新请求 |
| `[need_input]{...}[/need_input]` | 请求用户输入 | 暂停等待用户输入 |

**流式执行模式：**

每次迭代只执行一条指令：
1. AI 生成回复（可能包含多条标签）
2. 代码提取标签，只取第一条 `[command]`
3. 执行该指令
4. 刷新页面骨架
5. 携带执行结果请求下一条指令

**批量指令：** AI 可以输出数组格式的 `[command][{...},{...}][/command]`，代码逐条执行，单条失败不中断后续。

**最大步数：** 20 步（`MAX_TOTAL_STEPS`），包含成功、失败、重试、need_full

**模式说明（注入 `{coreRule}` 占位符）：**
- `MODE_FIRST`：首次执行，生成第 1 条指令
- `MODE_STREAMING`：继续执行，根据已完成步骤生成下一条
- `MODE_RETRY`：上次失败，调整策略重试

---

## /download — 数据提取

**用途：** 从当前页面提取数据，生成文件下载。

**触发方式：** `/download 提取所有商品名称和价格` 或自然语言描述

**处理流程：**

1. `extractDataElements()` 提取页面所有有文本内容的元素
2. 提取数据包括：文本、链接 href、图片 src/alt、表格 row/col、代码块
3. `cleanDataForExtraction()` 清洗，限制 500 条
4. `buildExtractPrompt()` 构建提示词
5. AI 生成 `[FILE:filename.ext]...[/FILE]` 标签
6. 前端解析文件标签，生成对应格式的文件并下载

**支持的输出格式：**

| 格式 | 说明 |
|------|------|
| .xlsx | Excel 表格（默认） |
| .csv | CSV 文本 |
| .json | JSON 数组 |
| .docx | Word 文档 |
| .txt | 纯文本 |

**自动化开关：** 如果网页自动化已关闭，返回提示信息而非提取数据。

---

## /summarize — 页面分析

**用途：** 分析总结当前页面内容。

**触发方式：** `/summarize 总结这篇文章的要点` 或自然语言描述

**处理流程：**

1. `extractPageText()` 通过 `document.body.innerText` 提取页面全文（限制 15000 字符）
2. `buildSummarizePrompt()` 构建提示词
3. AI 生成分析总结
4. 以聊天消息形式显示结果

**与 /download 的区别：**
- `/summarize` 输出聊天消息（分析总结）
- `/download` 输出文件下载（数据提取）

---

## need_input — 用户输入请求

AI 可以输出 `[need_input]` 标签请求用户提供信息。

**标签格式：**

```
[need_input]{"message":"请输入您的登录密码","type":"credentials"}[/need_input]
```

**type 类型：** `credentials` | `verification_code` | `confirm` | `other`

**处理流程：**

1. Pipeline 暂停执行
2. 通过 `callbacks.onNeedInput(message)` 显示提示
3. 用户输入后，通过 `provideInput(text)` 继续执行
4. 用户输入作为上下文传入下一轮 AI 调用

---

## 标签系统

### 支持的标签

| 标签 | 格式 | 用途 | 阶段 |
|------|------|------|------|
| `[action]` | `[action]`（无内容） | 操作意图标记 | Phase 1 |
| `[chat]` | `[chat]{"text":"..."}[/chat]` | 聊天回复 | Phase 1 |
| `[command]` | `[command]{...}[/command]` | 浏览器操作指令 | Phase 1 + Phase 2 |
| `[need_full]` | `[need_full]`（无内容） | 请求全页骨架 | Phase 2 |
| `[need_input]` | `[need_input]{"message":"..."}[/need_input]` | 请求用户输入 | Phase 2 |
| `[FILE:xxx]` | `[FILE:name.ext]内容[/FILE]` | 文件/图表输出 | Phase 1 |

---

## 重试机制

- **最大执行次数：** 20 次
- **连续错误追踪：** `consecutiveErrors` 计数，指令成功后重置为 0
- **重试时携带的信息：** 最新骨架、上次错误信息、上次失败指令、已完成指令列表、全页骨架、用户补充信息
- **指令去重：** `completedKeys` Set，key 格式 `"action:url/elementId/description:text"`

---

## 跨标签页任务续接

`navigate` 或 `_blank` 点击导致页面跳转时，当前 JS 上下文可能被销毁。Pipeline 通过 `queuedTaskStorage` 将未完成任务保存到 Chrome Storage：

1. 执行 click/navigate 前保存 queued task
2. 新标签页加载完成后读取 queued task
3. 过期检查（30 秒）
4. 跳过 Phase 1，直接 Phase 2 流式执行

---

## 输入历史

- 上限 100 条，FIFO 策略
- 连续相同文本自动去重
- 独立存储在 `ai-browser-input-history`
- 输入框支持上下箭头导航历史记录
