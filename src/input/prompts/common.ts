/**
 * 共享提示词常量
 *
 * 被 Phase1 / Phase2 / 翻译 / 数据提取共同引用。
 */

// ═══════════════════════════════════════════════════════════════
// 能力域定义
// ═══════════════════════════════════════════════════════════════

export interface CapabilityItem {
  id: string
  title: string
  desc: string
  needSkeleton: boolean
}

export const CAPABILITY_DOMAIN_LIST: CapabilityItem[] = [
  { id: 'navigate',   title: '打开网址',   desc: '打开URL（需url）',                     needSkeleton: false },
  { id: 'scroll',     title: '滚动页面',   desc: '滚动页面（direction:up/down/top/bottom/auto/stop/pause/resume）', needSkeleton: false },
  { id: 'newTab',     title: '新标签页',   desc: '打开新标签页',                          needSkeleton: false },
  { id: 'closeTab',   title: '关闭标签页', desc: '关闭当前标签页',                        needSkeleton: false },
  { id: 'nextTab',    title: '下一个标签', desc: '切换下一个标签页',                      needSkeleton: false },
  { id: 'prevTab',    title: '上一个标签', desc: '切换上一个标签页',                      needSkeleton: false },
  { id: 'switchTab',  title: '切换标签页', desc: '切换到指定标签页（需tabQuery）',          needSkeleton: false },
  { id: 'keyboard',   title: '模拟按键',   desc: '模拟按键（需key:Enter/Escape/Tab）',     needSkeleton: false },
  { id: 'wait',       title: '等待',       desc: '等待（需ms）',                          needSkeleton: false },
  { id: 'search',     title: '全网搜索',   desc: '全网搜索（需text）',                    needSkeleton: true },
  { id: 'click',      title: '点击元素',   desc: '点击元素（需elementId或description）',   needSkeleton: true },
  { id: 'type',       title: '输入文字',   desc: '输入文字（需elementId+text）',           needSkeleton: true },
  { id: 'clear',      title: '清空输入框', desc: '清空输入框（需elementId）',              needSkeleton: true },
  { id: 'select',     title: '选择下拉框', desc: '选择下拉框（需elementId+text）',         needSkeleton: true },
  { id: 'focus',      title: '聚焦元素',   desc: '聚焦元素（需elementId）',                needSkeleton: true },
  { id: 'hover',      title: '悬停元素',   desc: '悬停元素（需elementId）',                needSkeleton: true },
  { id: 'upload',     title: '上传文件',   desc: '上传文件到file input（需elementId+fileData）', needSkeleton: true },
  { id: 'slider',     title: '拖动滑块',   desc: '拖动滑块到指定值（需elementId+value）',  needSkeleton: true },
  { id: 'closeModal', title: '关闭弹窗',   desc: '关闭页面弹窗/对话框',                    needSkeleton: false },
  { id: 'download',   title: '提取数据',   desc: '提取页面数据并导出文件',                  needSkeleton: true },
  { id: 'summarize',  title: '分析总结',   desc: '提取页面全文并AI分析总结',                needSkeleton: true },
]

// 完整能力域列表（Phase2 用）
export const CAPABILITY_LIST = CAPABILITY_DOMAIN_LIST
  .map(item => `${item.id.padEnd(12)}— ${item.desc}`)
  .join('\n')

// 可直出 [command] 的列表（Phase1 用）
export const PHASE1_CAPABILITY_LIST = CAPABILITY_DOMAIN_LIST
  .filter(item => !item.needSkeleton)
  .map(item => `${item.id.padEnd(12)}— ${item.desc}`)
  .join('\n')

// ═══════════════════════════════════════════════════════════════
// 文件输出格式规则（Phase1 / Phase2 / download 共用）
// ═══════════════════════════════════════════════════════════════

export const FILE_FORMAT_RULES = `单个文件：[FILE:文件名.扩展名]内容[/FILE]
多个文件：[FILE:a.txt]内容1[/FILE][FILE:b.csv]内容2[/FILE]
图表（必须用 .chart）：[FILE:name.chart]ECharts option JSON[/FILE]

.chart 是系统内置的图表渲染格式，直接输出 ECharts option 对象 JSON。
系统会自动用 ECharts 渲染图表，无需生成 .vue/.html/.js 代码文件。
多图用多文件：[FILE:饼图.chart]{"series":[{"type":"pie","data":[...]}]}[/FILE]

示例：
[FILE:report.md]# 标题
内容[/FILE]
[FILE:data.csv]name,value
A,10
B,20[/FILE]
[FILE:销售饼图.chart]{"title":{"text":"销售占比"},"series":[{"type":"pie","radius":"60%","data":[{"value":1048,"name":"搜索引擎"},{"value":735,"name":"直接访问"}]}]}[/FILE]`

// ═══════════════════════════════════════════════════════════════
// 通用规则片段（多处复用）
// ═══════════════════════════════════════════════════════════════

/** 网站名转 URL 规则 */
export const SITE_URL_RULE = '网站名转URL：B站→bilibili.com, 淘宝→taobao.com, 百度→baidu.com, 知乎→zhihu.com, github→github.com'

/** [FILE] 扩展名规则 */
export const FILE_EXT_RULE = `- 文档类文件扩展名必须与用户要求一致（"生成pdf"→.pdf，"生成word"→.docx）
- 图表必须用 .chart 格式（ECharts option JSON），禁止生成 .vue/.html/.js 代码文件
- 文件名只能有一个扩展名（report.pdf ✓，report.pdf.md ✗）`

/** 标签闭合 + 单条规则（command 版） */
export const COMMAND_CLOSE_RULE = `- [command] 标签必须闭合：[command]{...}[/command]
- 每次只能输出1条 [command]
- 禁止输出分析/解释/说明/思考过程`
