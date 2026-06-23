---
name: site-gen
description: "扫描项目代码和 PRD，生成使用指南（guide.md + guide.html），输出到 docs/site/ 文件夹。"
---

# Site Gen — 使用文档生成

扫描项目代码库，提取所有用户可见功能，生成使用指南，输出到 `docs/site/` 文件夹。

## 输出文件

```
docs/site/
├── guide.html    # 使用指南 HTML（每次生成）
└── guide.md      # 使用指南 Markdown（每次生成）
```

> **注意：** 首页 `index.html` 手动维护，此技能不生成也不修改。

## 触发命令

- `/site-gen` — 全量生成 guide.md + guide.html

---

## 项目信息来源

从 `package.json` 读取：

| 字段 | 用途 |
|------|------|
| `name` | 产品名称 |
| `description` | 产品描述 |
| `author.name` | 作者 |
| `license` | 许可证 |
| `homepage` | 项目主页链接 |
| `repository.url` | 仓库地址 |

**版本号规则：** `git tag --sort=-creatordate | head -1`，无 tag 回退到 `package.json` 的 `version`。

---

## 核心原则

- **覆盖所有产品功能** — 每个按钮、每个交互、每个状态都要写到
- **以用户视角描述** — 不写内部实现，只写"是什么、怎么用、有什么效果"
- **每个功能配触发示例** — 用户该怎么说/输入才能触发对应功能
- **截图标记保留** — `📸 截图：xxx` 方便后续补图
- **HTML 自包含** — 单文件、内联样式、无外部依赖，可离线浏览

---

## 执行流程

### Step 0: 读取项目信息

```bash
cat package.json
git tag --sort=-creatordate | head -1
```

### Step 1: 扫描

并行读取所有组件和功能入口文件：

| 目的 | 路径 |
|------|------|
| UI 组件 | `entrypoints/content/components/*.vue` |
| 命令定义 | `src/input/prompts/common.ts` |
| 浏览器命令 | `src/browser/action-executor.ts` |
| AI 提供商 | `src/types.ts` (Provider, AppSettings) |
| 语音命令 | `src/voice/commandParser.ts` |
| 翻译功能 | `src/browser/translate-service.ts`, `src/browser/translate-click.ts` |
| 文件类型 | `src/utils/file-parsers.ts`, `src/utils/file-type.ts` |
| 主题 | `src/themes.ts` |
| PRD | `.trellis/tasks/*/prd.md` |

扫描时提取每个组件的：
- 所有可见 UI 元素（按钮、图标、文字、标签）
- 所有用户交互（点击、拖拽、键盘、粘贴）
- 所有状态变化和视觉反馈
- 所有提示文字和默认值

### Step 2: 生成使用指南（guide.md + guide.html）

**先写 `docs/site/guide.md`**，结构：

```
# {产品名称} 使用指南

> {产品描述}

## 1. 🚀 快速开始
## 2. 💬 AI 对话
## 3. 🌐 网页自动化
## 4. 🎤 语音控制
## 5. 🌍 智能翻译
## 6. 📎 文件处理
## 7. 📊 图表生成与文件输出
## 8. ⚙️ 设置说明
## 9. 🎨 主题
## 10. ⌨️ 快捷命令
## 11. 💡 使用技巧
## 12. ❓ 常见问题
```

**每个章节必须包含「触发示例」区块：**

```markdown
> **💡 试试这样说：**
>
> - "滚动到页面底部"
> - "帮我打开百度，搜索 AI 新闻"
> - "/navigate https://github.com"
```

**再基于 MD 生成 `docs/site/guide.html`**，要求：
- 单文件自包含（CSS 内联，无外部依赖）
- 左侧固定目录导航 + 顶部搜索框
- 表格斑马纹、代码块复制按钮
- 深色/浅色主题切换
- 页头：SVG Logo + 产品名称（package.json）+ 版本号（git tag）
- 页脚：`← 返回首页`（链接 index.html）+ GitHub + 下载 + 生成日期
- 触发示例用 `.trigger-tip` 样式（💡 图标 + 蓝色左边框）

---

## 内容标准

每个功能必须包含：
1. **是什么** — 一句话说明
2. **怎么用** — 操作步骤
3. **触发示例** — 用户该怎么说/输入（`> **💡 试试这样说：**`）
4. **使用示例** — 具体场景
5. **效果/反馈** — 操作后看到什么
6. **📸 截图** — 截图占位
7. **⚠️ 注意** — 仅在有坑时写

### 不写的内容

- ❌ 源文件路径、类名、函数名、变量名
- ❌ TypeScript 接口/类型定义
- ❌ 内部架构（适配器、骨架、SSE、存储 key）
- ❌ 实现参数（防抖间隔、重试次数、最大步数等）
- ❌ 开发命令（dev/build/test）
