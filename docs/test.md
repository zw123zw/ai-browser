# 测试用例 — 语音/文字双模式统一输入路由

把推荐下第一条内容给我点赞
打开第二条
滚动到页面底部
滚动 down
点击搜索框
搜索vue3内容
打开新标签页
关闭当前标签
打开B站
切换到 B 站标签
切换到微信标签
next tab
find 淘宝
open 淘宝
open 知乎
切换到短信登录，输入手机号 18674069215 再点击发送验证码，勾选弹框里同意用户协议

## 能力域覆盖测试

### navigate — 打开URL
打开 https://www.baidu.com
打开百度 https://www.baidu.com
跳转到 github.com
navigate https://example.com

### search — 全网搜索
搜索今天天气
百度一下怎么学编程
search javascript async await

### click — 点击元素
点击登录按钮
点第一个搜索结果
点赞
点一下关注
click e3
点击那个蓝色的按钮
收藏这条内容
点右边的关闭按钮

### type — 输入文字
在搜索框输入hello world
在输入框里打字 vue3教程
输入 邮箱地址

### clear — 清空输入框
清空搜索框
把输入框里的内容删掉

### select — 选择下拉框
选择北京
下拉框选 第三个选项

### keyboard — 模拟按键
按回车
按下 Enter 键
按 Esc 关闭弹窗
按 Tab 切换焦点
press Enter

### focus — 聚焦元素
聚焦到搜索框
focus 输入框

### hover — 悬停元素
鼠标悬停在菜单上
hover 用户头像

### wait — 等待
等3秒
wait 5000

### scroll — 滚动页面
往下滚
滚到最上面
scroll up
滚动300像素
往下翻一页

### newTab — 打开新标签页
新开一个标签页
new tab
打开空白页

### closeTab — 关闭标签页
关闭这个标签
close tab
关掉当前页面

### switchTab — 切换标签页
切到 B 站标签
切换到 GitHub 标签
switch to 淘宝 tab

### nextTab / prevTab — 前后切换标签
下一个标签
上一个标签
next tab
prev tab
切到左边的标签

### 多步操作
先点赞再收藏
打开百度然后搜索vue3
向下滚动到底部然后点击第一条
在搜索框输入vue3然后按回车

### 自然语言变体
帮我打开百度
你帮我搜一下今天新闻
麻烦把页面往下翻一下
能不能点一下那个提交按钮
给我新开个标签页
把当前标签关了吧

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
