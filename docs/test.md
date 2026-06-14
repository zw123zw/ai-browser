# 测试用例 — 语音/文字双模式统一输入路由

## Phase 1 IntentDetector 测试用例

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
| 9 | `翻译这个页面` | [action]，技能 |
| 10 | `向下滚动` | [action]，滚动 |

### 输出约束

| # | 测试点 | 验证 |
|---|--------|------|
| 11 | 不输出 [command] | AI 回复不含 `[command]` |
| 12 | 不输出 [skill] | AI 回复不含 `[skill]` |
| 13 | 异常输出时进 Phase 2 | 模拟返回 `[command]{...}` → 强制进 Phase 2 |
| 14 | 聊天回复 ≤ 100 字 | 长度校验 |

### 边界/歧义

| # | 输入 | 预期 |
|---|------|------|
| 15 | `我想翻译` | [action]，意图明确 |
| 16 | `帮我看看这个页面` | 需确认策略，可接受两种 |
| 17 | `click the button` | [action]，英文指令 |
| 18 | `你好，帮我打开百度` | [action]，混合输入取操作意图 |
| 19 | `今天心情不错` | isChat=true，闲聊 |
| 20 | `讲个笑话` | isChat=true，闲聊 |
| 21 | `帮我解释一下这段代码` | isChat=true，知识类 |
| 22 | `Vue和React哪个好` | isChat=true，讨论类 |
| 23 | `在搜索框输入hello` | [action]，输入操作 |
| 24 | `播放音乐` | [action]，媒体控制 |
| 25 | `暂停视频` | [action]，媒体控制 |
| 26 | `关闭弹窗` | [action]，页面操作 |
| 27 | `截图` | [action]，技能触发 |
| 28 | `帮我下单` | [action]，复合操作 |
| 29 | `为什么登录不了` | isChat=true，问题 |
| 30 | `这个按钮是什么` | isChat=true，提问 |

---

## 后续模块测试用例

> TODO: Phase 2、TagParser、SkeletonManager、Pipeline、ActionExecutor 等模块的测试用例待补充。
