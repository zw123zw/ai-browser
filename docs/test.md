# 测试用例文档

## 目录

- [1. 语音/文字统一输入路由](#1-语音文字统一输入路由)
- [2. Phase 1 IntentDetector](#2-phase-1-intentdetector)
- [3. 能力域覆盖测试](#3-能力域覆盖测试)
- [4. 多步操作与自然语言变体](#4-多步操作与自然语言变体)
- [5. 批量/数据操作场景](#5-批量数据操作场景)
- [6. Shadow DOM 遍历](#6-shadow-dom-遍历) ← 新增
- [7. 嵌套 iframe 递归](#7-嵌套-iframe-递归) ← 新增
- [8. 文件上传](#8-文件上传) ← 新增
- [9. 滑块 / range input](#9-滑块--range-input) ← 新增
- [10. 弹窗自动关闭](#10-弹窗自动关闭) ← 新增

---

## 测试页面索引

手动测试时使用以下页面：

| 功能 | 测试页面 | 说明 |
|------|----------|------|
| Shadow DOM | `https://mdn.github.io/web-components-examples/` | MDN WebComponent 示例集 |
| Shadow DOM | `https:// shoelace.style/` | Shoelace WebComponent 库（封闭 ShadowRoot） |
| Shadow DOM | 任意 Vue3 + Element Plus 页面 | Element Plus 组件使用 Shadow DOM |
| 嵌套 iframe | `https://iframetests.com/` 或自建 | 多层嵌套 iframe 测试页 |
| 嵌套 iframe | 企业 OA/ERP 系统 | 实际业务场景 |
| 文件上传 | `https://the-internet.herokuapp.com/upload` | 经典文件上传测试页 |
| 文件上传 | `https://www.baidu.com` 搜索框图片上传 | 百度搜图上传 |
| 滑块 | `https://mdn.github.io/learning-area/html/forms/range-example/` | MDN range input 示例 |
| 滑块 | `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/range` | MDN range 文档页 |
| 弹窗 | `https://getbootstrap.com/docs/5.3/components/modal/` | Bootstrap 弹窗示例 |
| 弹窗 | `https://element-plus.org/en-US/component/dialog.html` | Element Plus 弹窗 |
| 弹窗 | `https://ant.design/components/modal/` | Ant Design 弹窗 |

---

## 1. 语音/文字统一输入路由

| # | 输入 | 预期 |
|---|------|------|
| 1 | 打开第二条 | 点击第二条结果 |
| 2 | 把推荐下第一条内容给我点赞 | 点击第一条的点赞按钮 |
| 3 | 滚动到页面底部 | 滚动到底部 |
| 4 | 滚动 down | 向下滚动 |
| 5 | 点击搜索框 | 聚焦搜索框 |
| 6 | 搜索vue3内容 | 输入并搜索 |
| 7 | 打开新标签页 | 新建标签 |
| 8 | 关闭当前标签 | 关闭标签 |
| 9 | 打开B站 | 导航到 B 站 |
| 10 | 切换到 B 站标签 | 切换标签 |
| 11 | 切换到微信标签 | 切换标签 |
| 12 | next tab | 下一个标签 |
| 13 | find 淘宝 | 搜索淘宝 |
| 14 | open 淘宝 | 打开淘宝 |
| 15 | open 知乎 | 打开知乎 |

---

## 2. Phase 1 IntentDetector

### 聊天类（预期：自然语言回复，不进入 Phase 2）

| # | 输入 | 预期 |
|---|------|------|
| 1 | `你好` | isChat=true，返回自然语言 |
| 2 | `什么是量子计算` | isChat=true，知识问答 |
| 3 | `今天心情不错` | isChat=true，闲聊 |
| 4 | `谢谢` | isChat=true |
| 5 | `翻译是什么意思` | isChat=true，问词义不是执行 |

### 操作类（预期：返回 [action]）

| # | 输入 | 预期 |
|---|------|------|
| 6 | `点击登录按钮` | [action]，页面操作 |
| 7 | `打开B站` | [action]，导航 |
| 8 | `搜索Vue教程` | [action]，搜索 |
| 9 | `翻译这个页面` | [action]，页面操作 |
| 10 | `向下滚动` | [action]，滚动 |

### 输出约束

| # | 测试点 | 验证 |
|---|--------|------|
| 11 | 不输出 [command] | AI 回复不含 `[command]` |
| 12 | 异常输出时进 Phase 2 | 模拟返回 `[command]{...}` → 强制进 Phase 2 |
| 13 | 聊天回复 ≤ 100 字 | 长度校验 |

### 边界/歧义

| # | 输入 | 预期 |
|---|------|------|
| 14 | `我想翻译` | [action]，意图明确 |
| 15 | `帮我看看这个页面` | 可接受两种 |
| 16 | `click the button` | [action]，英文指令 |
| 17 | `你好，帮我打开百度` | [action]，混合输入取操作意图 |
| 18 | `今天心情不错` | isChat=true，闲聊 |
| 19 | `讲个笑话` | isChat=true，闲聊 |
| 20 | `帮我解释一下这段代码` | isChat=true，知识类 |
| 21 | `Vue和React哪个好` | isChat=true，讨论类 |
| 22 | `在搜索框输入hello` | [action]，输入操作 |
| 23 | `播放音乐` | [action]，媒体控制 |
| 24 | `暂停视频` | [action]，媒体控制 |
| 25 | `关闭弹窗` | [action]，页面操作 |
| 26 | `截图` | [action]，页面操作 |
| 27 | `帮我下单` | [action]，复合操作 |
| 28 | `为什么登录不了` | isChat=true，问题 |
| 29 | `这个按钮是什么` | isChat=true，提问 |
| 30 | `在搜索框输入hello` | [action]，输入操作 |

---

## 3. 能力域覆盖测试

### navigate — 打开URL

| # | 输入 | 预期 |
|---|------|------|
| 1 | 打开 https://www.baidu.com | 新标签打开百度 |
| 2 | 打开百度 https://www.baidu.com | 新标签打开百度 |
| 3 | 跳转到 github.com | 新标签打开 GitHub |
| 4 | navigate https://example.com | 新标签打开 |

### search — 全网搜索

| # | 输入 | 预期 |
|---|------|------|
| 5 | 搜索今天天气 | 百度搜索天气 |
| 6 | 百度一下怎么学编程 | 百度搜索 |
| 7 | search javascript async await | 英文搜索 |

### click — 点击元素

| # | 输入 | 预期 |
|---|------|------|
| 8 | 点击登录按钮 | 点击登录 |
| 9 | 点第一个搜索结果 | 点击第一条 |
| 10 | 点赞 | 点击点赞按钮 |
| 11 | 点一下关注 | 点击关注 |
| 12 | click e3 | 按 ID 点击 |
| 13 | 点击那个蓝色的按钮 | 按样式描述点击 |
| 14 | 收藏这条内容 | 点击收藏 |
| 15 | 点右边的关闭按钮 | 按位置点击 |

### type — 输入文字

| # | 输入 | 预期 |
|---|------|------|
| 16 | 在搜索框输入hello world | 输入文字 |
| 17 | 在输入框里打字 vue3教程 | 输入文字 |
| 18 | 输入 邮箱地址 | 输入文字 |

### clear — 清空输入框

| # | 输入 | 预期 |
|---|------|------|
| 19 | 清空搜索框 | 清空内容 |
| 20 | 把输入框里的内容删掉 | 清空内容 |

### select — 选择下拉框

| # | 输入 | 预期 |
|---|------|------|
| 21 | 选择北京 | 选中选项 |
| 22 | 下拉框选 第三个选项 | 选中第三项 |

### keyboard — 模拟按键

| # | 输入 | 预期 |
|---|------|------|
| 23 | 按回车 | 触发 Enter |
| 24 | 按下 Enter 键 | 触发 Enter |
| 25 | 按 Esc 关闭弹窗 | 触发 Escape |
| 26 | 按 Tab 切换焦点 | 触发 Tab |
| 27 | press Enter | 触发 Enter |

### focus — 聚焦元素

| # | 输入 | 预期 |
|---|------|------|
| 28 | 聚焦到搜索框 | 获取焦点 |
| 29 | focus 输入框 | 获取焦点 |

### hover — 悬停元素

| # | 输入 | 预期 |
|---|------|------|
| 30 | 鼠标悬停在菜单上 | 触发 hover |
| 31 | hover 用户头像 | 触发 hover |

### wait — 等待

| # | 输入 | 预期 |
|---|------|------|
| 32 | 等3秒 | 等待 3 秒 |
| 33 | wait 5000 | 等待 5 秒 |

### scroll — 滚动页面

| # | 输入 | 预期 |
|---|------|------|
| 34 | 往下滚 | 向下滚动 |
| 35 | 滚到最上面 | 滚动到顶部 |
| 36 | scroll up | 向上滚动 |
| 37 | 滚动300像素 | 精确滚动 |
| 38 | 往下翻一页 | 翻页滚动 |

### newTab — 打开新标签页

| # | 输入 | 预期 |
|---|------|------|
| 39 | 新开一个标签页 | 新建标签 |
| 40 | new tab | 新建标签 |
| 41 | 打开空白页 | 新建空白标签 |

### closeTab — 关闭标签页

| # | 输入 | 预期 |
|---|------|------|
| 42 | 关闭这个标签 | 关闭当前标签 |
| 43 | close tab | 关闭当前标签 |
| 44 | 关掉当前页面 | 关闭当前标签 |

### switchTab — 切换标签页

| # | 输入 | 预期 |
|---|------|------|
| 45 | 切到 B 站标签 | 切换到 B 站 |
| 46 | 切换到 GitHub 标签 | 切换到 GitHub |
| 47 | switch to 淘宝 tab | 切换到淘宝 |

### nextTab / prevTab — 前后切换标签

| # | 输入 | 预期 |
|---|------|------|
| 48 | 下一个标签 | 切到下一个 |
| 49 | 上一个标签 | 切到上一个 |
| 50 | next tab | 切到下一个 |
| 51 | prev tab | 切到上一个 |
| 52 | 切到左边的标签 | 切到上一个 |

---

## 4. 多步操作与自然语言变体

### 多步操作

| # | 输入 | 预期 |
|---|------|------|
| 1 | 先点赞再收藏 | 依次执行两个操作 |
| 2 | 打开百度然后搜索vue3 | 打开 → 输入 → 搜索 |
| 3 | 向下滚动到底部然后点击第一条 | 滚动 → 点击 |
| 4 | 在搜索框输入vue3然后按回车 | 输入 → 按键 |

### 自然语言变体

| # | 输入 | 预期 |
|---|------|------|
| 5 | 帮我打开百度 | 打开百度 |
| 6 | 你帮我搜一下今天新闻 | 搜索新闻 |
| 7 | 麻烦把页面往下翻一下 | 向下滚动 |
| 8 | 能不能点一下那个提交按钮 | 点击提交 |
| 9 | 给我新开个标签页 | 新建标签 |
| 10 | 把当前标签关了吧 | 关闭标签 |

---

## 5. 批量/数据操作场景

### 批量操作

| # | 输入 | 预期 |
|---|------|------|
| 1 | 批量指令 批量点赞、批量互动、批量评论 | 批量操作 |
| 2 | 批量填写表单 | 批量填表 |
| 3 | 批量填表、批量导出数据 | 批量操作 |
| 4 | 批量翻页下载文件 | 批量下载 |
| 5 | 自动签到 | 自动签到 |
| 6 | 后台批量操作 | 批量操作 |
| 7 | 名称 活动区域 活动形式 批量填入666 | 批量填表 |
| 8 | 给我批量点赞推荐列表前3条 | 批量点赞 |
| 9 | 重复网页操作自动化 | 自动化操作 |

### 数据提取与导出

| # | 输入 | 预期 |
|---|------|------|
| 10 | 一键提取网页结构化数据 | 提取 JSON |
| 11 | 用自然语言描述要抓取的内容，直接输出 JSON 结构化数据 | 数据提取 |
| 12 | 商品列表价格、标题、订单编号、用户信息、表格内容 | 数据提取 |
| 13 | 适合爬虫、数据统计、页面信息批量导出 | 数据导出 |
| 14 | 把基础表格的内容导出为excel给我 | 导出 Excel |
| 15 | 给我把当前描述列表的基础用法对的用户信息给我生成word文件 | 生成 Word |
| 16 | 给我把当前页面生成html | 生成 HTML |
| 17 | 给我输出一份 Vue3的饼图和柱状图和折线图图表 | 生成图表 |
| 18 | 给我输出一份 Vue3的Word和pdf报告 | 生成报告 |
| 19 | 给我输出一份常见代码文件格式以及常见文件格式的文件，用不同语言写出内容是你好 | 生成文件 |

### 视频控制

| # | 输入 | 预期 |
|---|------|------|
| 20 | 点击全屏播放 视频快进到3分钟 暂停视频 继续播放 | 视频控制 |

### 复合操作

| # | 输入 | 预期 |
|---|------|------|
| 21 | 帮我打开淘宝，然后短信登录，手机号18674069215 | 复合操作 |
| 22 | 帮我打开B站，然后短信登录，手机号18674069215 | 复合操作 |
| 23 | 帮我登录淘宝 | 复合操作 |
| 24 | 帮我登录B站 | 复合操作 |
| 25 | 帮我登录知乎 | 复合操作 |
| 26 | 帮我登录网易邮箱 | 复合操作 |
| 27 | 请打开掘金，查看最新一篇文章，总结一下内容 | 复合操作 |
| 28 | 给我把这篇文章内容填写上传到掘金 | 复合操作 |

---

## 6. Shadow DOM 遍历

> **目标**：skeleton 提取能穿透 shadowRoot，AI 能操作 Shadow DOM 内部元素。

### 6.1 基础功能

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 1 | Shoelace 官网 | 打开页面，查看 skeleton 提取结果 | Shadow DOM 内的按钮/输入框出现在元素列表中 |
| 2 | MDN WebComponent 示例 | 对 `<my-component>` 内的按钮说"点击按钮" | 能找到并点击 Shadow DOM 内的按钮 |
| 3 | Vue3 + Element Plus 页面 | 对 el-input 说"在输入框输入 hello" | 能找到 Shadow DOM 内的 input 并输入 |
| 4 | 包含 open shadowRoot 的页面 | 查看 skeleton | open mode 的 shadowRoot 被遍历 |
| 5 | 包含 closed shadowRoot 的页面 | 查看 skeleton | closed mode 被跳过，不影响其他元素 |

### 6.2 深度与性能

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 6 | 嵌套 Shadow DOM | 组件 A 的 shadowRoot 内包含组件 B | 递归遍历，B 内部元素可见 |
| 7 | 大量 WebComponent 的页面 | 打开有 100+ 组件的页面 | skeleton 提取不超时（< 3 秒） |
| 8 | 递归深度上限 | 构造 15 层嵌套 shadowRoot | 第 10 层后停止递归，不崩溃 |
| 9 | Shadow DOM 内的 iframe | Shadow 内有 `<iframe>` | 当前版本跳过（交叉场景 Out of Scope） |

### 6.3 Action 执行

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 10 | Shoelace 输入框 | "在输入框输入 test" | 文字正确输入 |
| 11 | Shoelace 按钮 | "点击按钮" | 按钮被点击，触发事件 |
| 11 | Shoelace 下拉框 | "选择第二个选项" | 下拉框选中 |
| 12 | Vue3 el-select | "选择北京" | Shadow DOM 内下拉框选中 |

### 6.4 单元测试（vitest）

```typescript
// src/browser/skeleton.test.ts 新增

describe('Shadow DOM 遍历', () => {
  it('应提取 open shadowRoot 内的元素', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Shadow Button</button>';
    document.body.appendChild(el);

    const result = extractSkeleton({ root: document.body });
    expect(result.elements.some(e => e.text === 'Shadow Button')).toBe(true);
  });

  it('应跳过 closed shadowRoot', () => {
    const el = document.createElement('div');
    const shadow = el.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<button>Closed Button</button>';
    document.body.appendChild(el);

    const result = extractSkeleton({ root: document.body });
    expect(result.elements.some(e => e.text === 'Closed Button')).toBe(false);
  });

  it('应递归遍历嵌套 Shadow DOM', () => {
    const outer = document.createElement('div');
    const outerShadow = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    outerShadow.appendChild(inner);
    const innerShadow = inner.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = '<input type="text" />';
    document.body.appendChild(outer);

    const result = extractSkeleton({ root: document.body });
    expect(result.elements.some(e => e.tag === 'input')).toBe(true);
  });

  it('应限制递归深度为 10 层', () => {
    // 构造 15 层嵌套
    let current = document.createElement('div');
    document.body.appendChild(current);
    for (let i = 0; i < 15; i++) {
      const shadow = current.attachShadow({ mode: 'open' });
      const next = document.createElement('div');
      shadow.appendChild(next);
      current = next;
    }
    current.innerHTML = '<button>Deep Button</button>';

    const result = extractSkeleton({ root: document.body });
    // 第 10 层后停止，Deep Button 在第 15 层不应出现
    expect(result.elements.some(e => e.text === 'Deep Button')).toBe(false);
  });
});
```

---

## 7. 嵌套 iframe 递归

> **目标**：skeleton 提取能递归处理 iframe 内的 iframe，统一全局元素索引。

### 7.1 基础功能

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 1 | 2 层嵌套 iframe 页面 | 打开页面，查看 skeleton | 两层 iframe 内的元素均出现 |
| 2 | 3 层嵌套 iframe 页面 | 查看 skeleton | 三层元素均可见 |
| 3 | 同域 + 跨域混合嵌套 | 查看 skeleton | 两种类型均正确处理 |
| 4 | 跨域 iframe 嵌套跨域 iframe | 查看 skeleton | 逐层注入提取 |

### 7.2 元素 ID 与定位

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 5 | ID 前缀层级化 | 查看 skeleton 输出 | 顶层 `e1`，第一层 iframe `fi1_e1`，第二层 `fi1_fi1_e1` |
| 6 | 跨域 iframe 元素 ID | 查看 skeleton 输出 | 跨域元素有 `f_` 前缀 |
| 7 | Action 定位嵌套 iframe 内元素 | "点击第二层 iframe 内的按钮" | 正确切换上下文并点击 |

### 7.3 递归限制

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 8 | 递归深度限制 | 构造 8 层嵌套 iframe | 第 5 层后停止递归 |
| 9 | 循环 iframe 引用 | iframe A 嵌入 iframe B，B 嵌入 A | 不死循环，正常终止 |
| 10 | 空 iframe | `<iframe src="about:blank">` | 跳过，不报错 |
| 11 | 加载失败的 iframe | `<iframe src="invalid">` | 跳过，不报错 |

### 7.4 Action 执行

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 12 | 2 层嵌套 iframe | "点击第二层的提交按钮" | 正确执行点击 |
| 13 | 跨域 iframe 内输入框 | "在输入框输入 hello" | 正确输入文字 |
| 14 | 嵌套 iframe 内下拉框 | "选择北京" | 正确选中 |

### 7.5 单元测试（vitest）

```typescript
// src/browser/skeleton.test.ts 新增

describe('嵌套 iframe 递归', () => {
  it('应提取同域 iframe 内的元素', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML = '<button>Iframe Button</button>';

    const result = extractSkeleton({ root: document.body });
    expect(result.elements.some(e => e.text === 'Iframe Button')).toBe(true);
  });

  it('应限制 iframe 递归深度为 5 层', () => {
    // 构造 8 层嵌套（需要 mock chrome.scripting）
    // 验证第 5 层后停止
  });

  it('应正确分配层级化 ID 前缀', () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'test-frame';
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML = '<button>Btn</button>';

    const result = extractSkeleton({ root: document.body });
    const btn = result.elements.find(e => e.text === 'Btn');
    expect(btn?.elementId).toMatch(/^fi.*_e\d+$/);
  });

  it('应处理空 iframe 不报错', () => {
    const iframe = document.createElement('iframe');
    iframe.src = 'about:blank';
    document.body.appendChild(iframe);

    expect(() => extractSkeleton({ root: document.body })).not.toThrow();
  });
});
```

---

## 8. 文件上传

> **目标**：用户在聊天框附件文件 → AI 自动填入页面 `<input type="file">` → 触发 change 事件。

### 8.1 基础功能

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 1 | herokuapp/upload | 聊天框附件一个 txt 文件，说"上传这个文件" | 文件填入 input，页面显示文件名 |
| 2 | herokuapp/upload | 附件图片文件，说"上传图片" | 图片填入 input |
| 3 | 百度搜图 | 附件图片，说"用这张图搜索" | 图片上传到百度搜图 |
| 4 | 多文件上传页面 | 附件多个文件，说"批量上传这些文件" | 多个文件全部填入 |

### 8.2 框架兼容性

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 5 | React 应用的 file input | 上传文件 | React 的 onChange 被触发 |
| 6 | Vue 应用的 file input | 上传文件 | Vue 的 @change 被触发 |
| 7 | Angular 应用的 file input | 上传文件 | Angular 的 (change) 被触发 |
| 8 | 原生 HTML file input | 上传文件 | change 事件触发 |

### 8.3 降级策略

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 9 | Content Script 直接操作 | 标准 file input | DataTransfer 方案成功 |
| 10 | Main-world 降级 | 框架拦截 change 事件时 | 自动降级到 main-world 注入 |
| 11 | 跨域页面上传 | 跨域 iframe 内的 file input | 通过 iframe action 通道上传 |

### 8.4 边界情况

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 12 | accept 属性限制 | input accept="image/*"，上传 txt | AI 提示格式不匹配 |
| 13 | 文件大小限制 | 上传超大文件 | 正常填入，由页面端校验 |
| 14 | 非 file 类型 input | 对 `<input type="text">` 说上传 | 提示目标不是文件输入框 |
| 15 | Dropzone 拖拽区域 | 页面只有 dropzone 无 input | 需要 drag 事件序列（当前版本不支持，标注） |

### 8.5 单元测试（vitest）

```typescript
// src/browser/action-executor.test.ts 新增

describe('upload action', () => {
  it('应通过 DataTransfer 设置文件', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);

    const executor = new ActionExecutor();
    await executor.execute({
      action: 'upload',
      elementId: 'test',
      fileData: {
        base64: btoa('hello world'),
        name: 'test.txt',
        mimeType: 'text/plain',
      },
    });

    expect(input.files).toHaveLength(1);
    expect(input.files![0].name).toBe('test.txt');
  });

  it('应触发 change 事件', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);

    let changeFired = false;
    input.addEventListener('change', () => { changeFired = true; });

    const executor = new ActionExecutor();
    await executor.execute({
      action: 'upload',
      elementId: 'test',
      fileData: { base64: btoa('test'), name: 'test.txt', mimeType: 'text/plain' },
    });

    expect(changeFired).toBe(true);
  });

  it('应对非 file input 返回失败', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    const executor = new ActionExecutor();
    const result = await executor.execute({
      action: 'upload',
      elementId: 'test',
      fileData: { base64: btoa('test'), name: 'test.txt', mimeType: 'text/plain' },
    });

    expect(result.success).toBe(false);
  });
});
```

---

## 9. 滑块 / range input

> **目标**：AI 能按文字描述操作 `<input type="range">` 和自定义滑块。

### 9.1 基础功能

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 1 | MDN range 示例 | "把滑块拖到 50" | 滑块值变为 50 |
| 2 | MDN range 示例 | "音量调到 80%" | 滑块拖到 80% 位置 |
| 3 | MDN range 示例 | "把亮度拉到最大" | 滑块拖到 max 值 |
| 4 | MDN range 示例 | "把滑块拖到最小" | 滑块拖到 min 值 |

### 9.2 自定义滑块

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 5 | Element Plus slider | "把滑块调到 60" | 自定义滑块组件值变化 |
| 6 | Ant Design slider | "滑块调到 30" | Ant Design 滑块响应 |
| 7 | role="slider" 元素 | "拖到 70%" | ARIA slider 可操作 |

### 9.3 事件序列

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 8 | mousedown 事件 | 拖拽滑块 | 触发 mousedown |
| 9 | mousemove 事件 | 拖拽过程中 | 多次 mousemove 事件 |
| 10 | mouseup 事件 | 拖拽结束 | 触发 mouseup |
| 11 | input/change 事件 | 值变化时 | 触发 input 和 change 事件 |

### 9.4 边界情况

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 12 | step 属性 | range step=10，拖到 55 | 值对齐到 step（60） |
| 13 | 垂直滑块 | orient="vertical" 的 range | 正确计算 Y 轴拖拽 |
| 14 | 禁用滑块 | disabled 的 range | 提示元素不可操作 |

### 9.5 单元测试（vitest）

```typescript
// src/browser/action-executor.test.ts 新增

describe('slider action', () => {
  it('应将 range input 设置到指定值', async () => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = '0';
    document.body.appendChild(input);

    const executor = new ActionExecutor();
    await executor.execute({
      action: 'slider',
      elementId: 'test',
      value: 80,
    });

    expect(Number(input.value)).toBe(80);
  });

  it('应触发 mousedown/mousemove/mouseup 事件序列', async () => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    document.body.appendChild(input);

    const events: string[] = [];
    input.addEventListener('mousedown', () => events.push('down'));
    input.addEventListener('mousemove', () => events.push('move'));
    input.addEventListener('mouseup', () => events.push('up'));

    const executor = new ActionExecutor();
    await executor.execute({ action: 'slider', elementId: 'test', value: 50 });

    expect(events).toContain('down');
    expect(events).toContain('up');
    expect(events.filter(e => e === 'move').length).toBeGreaterThan(0);
  });

  it('应对禁用的滑块返回失败', async () => {
    const input = document.createElement('input');
    input.type = 'range';
    input.disabled = true;
    document.body.appendChild(input);

    const executor = new ActionExecutor();
    const result = await executor.execute({ action: 'slider', elementId: 'test', value: 50 });

    expect(result.success).toBe(false);
  });
});
```

---

## 10. 弹窗自动关闭

> **目标**：AI 能自动识别并关闭各类弹窗，支持多层弹窗逐层关闭。

### 10.1 基础功能

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 1 | Bootstrap modal | "关闭弹窗" | 弹窗关闭 |
| 2 | Element Plus dialog | "关闭弹窗" | 弹窗关闭 |
| 3 | Ant Design modal | "关闭弹窗" | 弹窗关闭 |
| 4 | 原生 `<dialog>` | "关闭弹窗" | dialog.close() 被调用 |

### 10.2 多层弹窗

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 5 | 2 层弹窗叠加 | "关闭所有弹窗" | 逐层关闭，页面可交互 |
| 6 | 确认框 + 弹窗 | "关闭弹窗" | 先关确认框，再关弹窗 |
| 7 | 3 层嵌套弹窗 | "关闭所有弹窗" | 全部关闭 |

### 10.3 关闭策略

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 8 | × 按钮 | 弹窗有 × 关闭按钮 | 点击 × 关闭 |
| 9 | "取消" 按钮 | 弹窗有取消按钮 | 点击取消关闭 |
| 10 | 遮罩点击 | 弹窗点击遮罩可关闭 | 点击遮罩关闭 |
| 11 | Escape 键 | 按 Esc 关闭 | 触发 Escape 关闭 |
| 12 | 无关闭按钮的弹窗 | 只有确认按钮 | 点击确认关闭 |

### 10.4 框架兼容性

| # | 测试页 | 操作 | 预期 |
|---|--------|------|------|
| 13 | Element Plus el-message-box | "关闭弹窗" | 消息弹窗关闭 |
| 14 | Ant Design notification | "关闭通知" | 通知关闭 |
| 15 | Vuetify v-dialog | "关闭弹窗" | Vuetify 弹窗关闭 |
| 16 | Material UI dialog | "关闭弹窗" | MUI 弹窗关闭 |

### 10.5 边界情况

| # | 测试点 | 操作 | 预期 |
|---|--------|------|------|
| 17 | 无弹窗时调用 | "关闭弹窗" | 提示无弹窗可关闭 |
| 18 | 不可关闭的弹窗 | 无关闭按钮的模态框 | 提示无法自动关闭 |
| 19 | 弹窗关闭后页面状态 | 关闭弹窗后操作页面 | 页面可正常交互 |

### 10.6 单元测试（vitest）

```typescript
// src/browser/action-executor.test.ts 新增

describe('closeModal action', () => {
  it('应关闭原生 dialog 弹窗', async () => {
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.appendChild(dialog);

    const executor = new ActionExecutor();
    await executor.execute({ action: 'closeModal' });

    expect(dialog.open).toBe(false);
  });

  it('应关闭 Bootstrap modal', async () => {
    document.body.innerHTML = `
      <div class="modal show" style="display: block">
        <div class="modal-dialog">
          <div class="modal-content">
            <button class="btn-close" data-bs-dismiss="modal"></button>
          </div>
        </div>
      </div>
    `;

    const executor = new ActionExecutor();
    await executor.execute({ action: 'closeModal' });

    // Bootstrap modal 关闭后移除 show class 或隐藏
    const modal = document.querySelector('.modal');
    expect(modal?.classList.contains('show')).toBe(false);
  });

  it('应逐层关闭多层弹窗', async () => {
    const dialog1 = document.createElement('dialog');
    const dialog2 = document.createElement('dialog');
    dialog1.open = true;
    dialog2.open = true;
    document.body.appendChild(dialog1);
    document.body.appendChild(dialog2);

    const executor = new ActionExecutor();
    await executor.execute({ action: 'closeModal' });

    expect(dialog1.open).toBe(false);
    expect(dialog2.open).toBe(false);
  });

  it('无弹窗时应返回提示', async () => {
    const executor = new ActionExecutor();
    const result = await executor.execute({ action: 'closeModal' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('无弹窗');
  });
});
```

---

## 通用测试检查清单

每次实现新功能后，运行以下检查：

- [ ] `npm run compile` — 类型检查通过
- [ ] `npm run test` — 所有单元测试通过
- [ ] `npm run build` — 构建成功（prod + debug）
- [ ] 在测试页面手动验证功能
- [ ] 检查 Logger 输出无异常
- [ ] 检查 skeleton 提取结果包含新元素类型
- [ ] 检查 AI prompt 中的能力描述已更新
