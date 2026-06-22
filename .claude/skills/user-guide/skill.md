---
name: user-guide
description: "扫描项目代码和 PRD，生成面向用户的使用指南（MD + HTML）和科幻风格首页，输出到 docs/user-guide/ 文件夹。覆盖所有产品功能，含操作步骤、触发示例和使用示例，不写技术实现。"
---

# User Guide — 用户使用文档生成

扫描项目代码库，提取所有用户可见功能，生成完整的使用指南，同时输出 **Markdown** 和 **HTML** 两个版本到 `docs/user-guide/` 文件夹。

## 输出文件

```
docs/user-guide/
├── home.html        # 科幻风格产品首页（仅首次生成，不随 --update 更新）
├── user-guide.md    # Markdown 源文件（便于编辑和版本管理）
└── user-guide.html  # HTML 单文件（便于浏览器直接打开、分享）
```

## 项目信息来源

所有项目信息从 `package.json` 读取：

| 字段 | 用途 |
|------|------|
| `name` | 产品名称（HTML Logo 文字、首页标题） |
| `description` | 产品描述（首页副标题、HTML 页头） |
| `version` | 版本号（仅作为 fallback） |
| `author.name` | 作者 |
| `license` | 许可证 |
| `homepage` | 项目主页链接 |
| `repository.url` | 仓库地址 |
| `keywords` | SEO 关键词（首页 meta） |

**版本号规则：** 优先使用 `git tag --sort=-creatordate | head -1` 获取最新 tag；无 tag 时回退到 `package.json` 的 `version` 字段。

## 核心原则

- **覆盖所有产品功能** — 每个按钮、每个交互、每个状态都要写到
- **以用户视角描述** — 不写内部实现，只写"是什么、怎么用、有什么效果"
- **每个功能配触发示例** — 用户具体该怎么说/输入才能触发对应功能
- **每个功能配使用示例** — 具体场景，不是抽象描述
- **截图标记保留** — `📸 截图：xxx` 方便后续补图
- **HTML 自包含** — 单文件、内联样式、无外部依赖，可离线浏览

## 触发

- `/user-guide` — 全量生成（含首页）
- `/user-guide --update` — 增量更新（仅变化模块，不重新生成首页）
- `/user-guide --home` — 仅重新生成首页

---

## 执行流程

### Step 0: 读取项目信息

```bash
# 读取 package.json
cat package.json

# 获取最新版本号
git tag --sort=-creatordate | head -1
# 无 tag 时回退到 package.json version
```

提取：产品名称、描述、版本号、作者、许可证、主页、仓库、关键词。

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

### Step 2: 生成文档

**先写 MD**，结构：

```
# {产品名称} 使用指南

> {产品描述}

## 1. 🚀 快速开始        — 安装、配置、打开方式
## 2. 💬 AI 对话          — 发消息、切模型、附件、深度思考、消息管理
## 3. 🌐 网页自动化       — 自然语言操作、全部命令、滚动/视频/标签页
## 4. 🎤 语音控制         — 开启、状态、命令、纯聊天模式
## 5. 🌍 智能翻译         — 三种模式、目标语言、代码保护
## 6. 📎 文件处理         — 格式、上传、OCR、预览、下载
## 7. 📊 图表生成         — 图表类型、导出
## 8. ⚙️ 设置说明         — 模型配置、通用配置、用户配置（所有设置项）
## 9. 🎨 主题             — 10 款主题
## 10. ⌨️ 快捷命令        — 斜杠命令、键盘快捷键
## 11. 💡 使用技巧        — 场景化技巧
## 12. ❓ 常见问题        — Q&A
```

**每个章节必须包含「触发示例」区块：**

每个功能模块下方用引用块写出具体的触发话术，告诉用户"该怎么说/怎么输入"：

```markdown
> **💡 试试这样说：**
>
> - "滚动到页面底部"
> - "帮我打开百度，搜索 AI 新闻"
> - "把这个页面的内容总结一下"
> - "把表格下载为 Excel"
> - "/navigate https://github.com"
> - "/scroll auto"
```

**再基于 MD 生成 HTML**，要求：
- 单文件自包含（CSS 内联，无外部依赖）
- 响应式布局，移动端友好
- 左侧固定目录导航（点击跳转锚点）
- 顶部搜索框（关键词高亮 + 锚点定位）
- 表格带斑马纹和边框
- 代码块带语言标签和复制按钮
- 引用块（提示/注意）带图标和左侧色条
- 截图占位用虚线框 + 文字说明
- 打印友好（@media print）
- 深色/浅色主题切换（prefers-color-scheme + 手动切换按钮）
- 页头：Logo（内联 SVG 芯片图标）+ 产品名称（来自 package.json name）+ 版本号（来自 git tag）
- 页脚：生成日期 + 版权 + 项目主页链接

### Step 3: 生成首页（仅首次或 `--home`）

生成 `docs/user-guide/home.html`，要求：

**视觉风格：科幻 / 赛博朋克**
- 深色背景（#0a0e1a），带粒子星空动画
- 霓虹色调（cyan #00e5ff, magenta #ff00ff, electric blue #0090FF）
- 标题文字发光效果（text-shadow 多层霓虹光晕）
- 卡片悬浮 + 边框渐变光效
- 滚动触发的淡入动画（IntersectionObserver）
- 鼠标跟随的光晕效果
- 六边形网格背景动画
- 扫描线效果（伪元素横线从上到下循环）

**页面结构：**
```html
1. Hero 区域
   - 产品 Logo（SVG 芯片图标，带脉冲动画）
   - 产品名称（package.json name，霓虹发光）
   - 产品描述（package.json description）
   - 版本号 + 许可证
   - 两个 CTA 按钮：
     a. 「下载插件」→ 指向 repository.url 的 releases 页面
     b. 「使用指南」→ 跳转 user-guide.html
   - 按钮悬浮发光动画

2. 功能亮点（4-6 个卡片）
   - AI 对话 · 网页自动化 · 语音控制 · 智能翻译 · 文件处理 · 图表生成
   - 每个卡片：图标 + 标题 + 一句话描述
   - 卡片边框渐变 + 悬浮发光
   - IntersectionObserver 滚动淡入

3. 支持的 AI 提供商（Logo 网格或文字列表）
   - 11 个提供商名称
   - 自动滚动 marquee 效果

4. 快速开始（3 步）
   - 安装 → 配置模型 → 开始使用
   - 步骤间连线动画

5. 页脚
   - 版权信息（author.name + 年份）
   - GitHub 链接（repository.url）
   - 许可证（license）
```

**动画技术：**
- CSS @keyframes 用于粒子、发光、扫描线
- CSS transitions 用于 hover 效果
- IntersectionObserver 用于滚动淡入
- requestAnimationFrame 用于粒子星空（canvas）
- 所有动画 prefers-reduced-motion 可关闭

**自包含要求：**
- 所有 CSS 内联在 `<style>` 标签
- 所有 JS 内联在 `<script>` 标签
- Logo 用内联 SVG
- 无外部字体/图标库依赖
- 无外部图片依赖

---

## 内容标准

每个功能必须包含：
1. **是什么** — 一句话说明
2. **怎么用** — 操作步骤（编号列表）
3. **触发示例** — 用户该怎么说/输入（引用块，带 💡 图标）
4. **使用示例** — 具体场景（引用块或代码块）
5. **效果/反馈** — 操作后会看到什么
6. **📸 截图** — 截图占位（如有代表性 UI）
7. **⚠️ 注意** — 仅在有坑时写

### 不写的内容

- ❌ 源文件路径、类名、函数名、变量名
- ❌ TypeScript 接口/类型定义
- ❌ 内部架构（适配器、骨架、SSE、存储 key）
- ❌ 实现参数（防抖间隔、重试次数、最大步数等）
- ❌ 开发命令（dev/build/test）

---

## 格式规范

### Markdown

- emoji 区分章节和功能类型
- 表格展示选项和对比
- 编号列表展示操作步骤
- 引用块展示使用示例和触发话术
- `📸 截图：` 截图占位
- `> **提示：**` 技巧
- `> **注意：**` 易踩的坑
- `> **💡 试试这样说：**` 触发话术示例

### HTML (user-guide.html)

- 从 MD 内容完整转换，不丢信息
- 内联 CSS，主题变量用 CSS custom properties
- 目录结构：`<nav>` 侧边栏 + `<main>` 内容区
- 搜索：纯 JS 实现，遍历文本节点高亮匹配
- 锚点：每个 `h2`/`h3` 自动生成 `id`
- 表格：`<table>` + `striped` 样例
- 代码块：`<pre><code>` + 复制按钮 JS
- 引用块：`.tip` / `.warning` / `.trigger` 样式类
- 截图占位：`.screenshot-placeholder` 虚线框
- 页头 Logo：内联 SVG 芯片图标 + 产品名称（package.json name）+ 版本号（git tag）
- 触发示例块：`.trigger-tip` 样式（💡 图标 + 蓝色左边框）

### HTML (home.html)

- 科幻风格单页，自包含
- 粒子星空 canvas 背景
- 霓虹发光文字 + 卡片
- 滚动淡入动画
- 响应式（移动端适配）
- 所有项目信息来自 package.json
- CTA 按钮链接到 releases 页和 user-guide.html
