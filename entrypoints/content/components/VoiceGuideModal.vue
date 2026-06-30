<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '@/src/i18n';

const emit = defineEmits<{ (e: 'close'): void }>();
const { t } = useI18n();

const activeTab = ref<'quick' | 'engine' | 'permission' | 'tips' | 'faq'>('quick');

const tabs = [
  { key: 'quick' as const, label: '快速开始' },
  { key: 'engine' as const, label: '引擎配置' },
  { key: 'permission' as const, label: '权限说明' },
  { key: 'tips' as const, label: '注意事项' },
  { key: 'faq' as const, label: '常见问题' },
];

const faqItems = [
  { q: '提示"麦克风权限被拒绝"怎么办？', a: '点击浏览器地址栏左侧的 🔒 图标 → 找到"麦克风" → 改为"允许"。然后刷新页面重试。' },
  { q: 'Web Speech API 提示"网络错误"？', a: 'Web Speech API 依赖 Google 服务，国内网络无法直接使用。请切换到讯飞或火山引擎。' },
  { q: '讯飞提示"鉴权失败"？', a: '检查 App ID、API Key、API Secret 是否都正确填入，确认已在讯飞控制台开通"语音听写"服务。' },
  { q: '火山引擎连接失败？', a: '检查 App ID 和 API Key（Access Token）是否正确复制，没有多余空格。在火山控制台确认 Token 未过期。' },
  { q: '识别不准确怎么办？', a: '确保环境安静、麦克风距离嘴巴 20-50cm、语速适中吐字清晰。如果某个引擎效果差，尝试切换到另一个引擎。' },
  { q: '说唤醒词没反应？', a: '确认语音面板已打开、麦克风权限已授权。检查唤醒词是否被修改过（设置 → 语音配置 → 唤醒词）。' },
  { q: '切换引擎后需要重新配置吗？', a: '是的，每个引擎需要独立配置 Key。切换后之前的 Key 配置会保留，不需要重新填入。' },
  { q: '免费额度用完了怎么办？', a: '讯飞：等待下一年重置或购买付费套餐。火山：购买付费套餐。或者切换到另一个引擎继续使用。' },
  { q: '麦克风被其他应用占用怎么办？', a: '关闭其他使用麦克风的应用（如微信语音、Teams、Zoom 等），然后重新打开语音面板。' },
];
</script>

<template>
  <div class="aib-vgm-mask" @click.self="emit('close')">
    <div class="aib-vgm-modal">
      <!-- 标题 + Tab 合并行 -->
      <div class="aib-vgm-header">
        <span class="aib-vgm-title">📖 使用指南</span>
        <div class="aib-vgm-tabs">
          <button
            v-for="tabItem in tabs"
            :key="tabItem.key"
            :class="['aib-vgm-tab', { 'aib-vgm-tab-active': activeTab === tabItem.key }]"
            @click="activeTab = tabItem.key"
          >
            {{ tabItem.label }}
          </button>
        </div>
        <button class="aib-vgm-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="aib-vgm-body">
        <!-- Tab 1: 快速开始 -->
        <div v-if="activeTab === 'quick'" class="aib-vgm-content">
          <h3>语音助手是什么？</h3>
          <p>小灵的语音助手让您通过说话控制浏览器。说"你好，小灵"唤醒后，直接说出指令即可执行操作，如"打开百度"、"搜索今天的新闻"、"点击第一个结果"等。</p>

          <h3>3 步开始使用：</h3>
          <div class="aib-vgm-steps">
            <div class="aib-vgm-step">
              <span class="aib-vgm-step-num">①</span>
              <div>
                <strong>选择识别引擎</strong>
                <p>海外用户 → 选 <b>Web Speech API</b>（零配置，直接用）<br>国内用户 → 选 <b>讯飞语音</b> 或 <b>火山引擎</b>（需注册获取 Key）</p>
              </div>
            </div>
            <div class="aib-vgm-step">
              <span class="aib-vgm-step-num">②</span>
              <div>
                <strong>填入 API Key（仅讯飞/火山需要）</strong>
                <p>按照"引擎配置" tab 的步骤获取 Key，填入对应输入框，点击保存</p>
              </div>
            </div>
            <div class="aib-vgm-step">
              <span class="aib-vgm-step-num">③</span>
              <div>
                <strong>开始使用</strong>
                <p>打开语音面板（点击工具栏麦克风图标或按 Ctrl+Shift+M）<br>说"你好，小灵"唤醒，然后说出你的指令，如"打开B站"</p>
              </div>
            </div>
          </div>

          <h3>引擎对比一览：</h3>
          <div class="aib-vgm-table-wrap">
            <table class="aib-vgm-table">
              <thead>
                <tr><th></th><th>Web Speech API</th><th>讯飞语音</th><th>火山引擎</th></tr>
              </thead>
              <tbody>
                <tr><td>适用场景</td><td>海外用户、快速体验</td><td>国内用户、方言识别</td><td>国内用户、大额需求</td></tr>
                <tr><td>免费额度</td><td>无限（浏览器内置）</td><td>50 万次/年</td><td>50 万分钟</td></tr>
                <tr><td>配置难度</td><td>⭐ 零配置</td><td>⭐⭐ 中等</td><td>⭐⭐ 简单</td></tr>
                <tr><td>需要填写</td><td>无</td><td>App ID + API Key + API Secret</td><td>App ID + API Key</td></tr>
                <tr><td>中文识别</td><td>一般</td><td>⭐⭐⭐ 顶级</td><td>⭐⭐⭐ 优秀</td></tr>
                <tr><td>方言支持</td><td>有限</td><td>20+ 方言</td><td>一般</td></tr>
                <tr><td>嘈杂环境</td><td>一般</td><td>⭐⭐⭐ 降噪强</td><td>⭐⭐ 较好</td></tr>
                <tr><td>网络要求</td><td>需访问 Google</td><td>国内直连</td><td>国内直连</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 2: 引擎配置 -->
        <div v-if="activeTab === 'engine'" class="aib-vgm-content">
          <h3>▎Web Speech API</h3>
          <p>无需任何配置，Chrome/Edge 浏览器原生支持。</p>
          <ul>
            <li>✅ 优点：零配置、免费、开箱即用</li>
            <li>❌ 限制：需要能访问 Google 服务（国内网络无法直接使用）</li>
            <li>💡 适用：海外用户、快速体验语音功能</li>
          </ul>
          <p>如果提示"网络错误"，说明无法连接 Google 服务。请切换到讯飞或火山引擎。</p>

          <hr>

          <h3>▎讯飞语音听写</h3>
          <p><strong>申请步骤：</strong></p>
          <div class="aib-vgm-steps">
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">1</span><div><strong>注册讯飞开放平台账号</strong><p>访问 <a href="https://www.xfyun.cn/" target="_blank">https://www.xfyun.cn/</a>，点击右上角"注册"。<br>⚠️ <b>必须完成实名认证</b>，否则无法创建应用。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">2</span><div><strong>创建应用</strong><p>登录后进入"控制台" → 点击"创建新应用" → 填写应用名称 → 应用平台选择 <b>"Web"</b>。<br>创建成功后记下 <b>App ID</b>（8 位字母数字，如 <code>409873f8</code>）。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">3</span><div><strong>开通语音听写服务</strong><p>进入应用详情页 → 找到"语音听写"服务，点击"开通"。<br>开通成功后进入"接口鉴权信息"页面。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">4</span><div><strong>获取 API Key 和 API Secret</strong><p>在"接口鉴权信息"页面复制 <b>API Key</b> 和 <b>API Secret</b>。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">5</span><div><strong>填入小灵设置</strong><p>回到小灵设置 → 语音配置 → 引擎选择"讯飞语音" → 填入 App ID、API Key、API Secret → 保存。</p></div></div>
          </div>

          <h4>各字段含义：</h4>
          <div class="aib-vgm-table-wrap">
            <table class="aib-vgm-table">
              <thead><tr><th>字段</th><th>说明</th><th>在哪里找</th></tr></thead>
              <tbody>
                <tr><td>App ID</td><td>应用唯一标识，8 位字母数字</td><td>应用详情页顶部</td></tr>
                <tr><td>API Key</td><td>接口调用凭证，32 位字符串</td><td>接口鉴权信息页</td></tr>
                <tr><td>API Secret</td><td>签名密钥，32 位字符串</td><td>接口鉴权信息页</td></tr>
              </tbody>
            </table>
          </div>
          <p class="aib-vgm-warn">⚠️ 三个字段缺一不可，填错任何一个都会提示"鉴权失败"。</p>

          <hr>

          <h3>▎火山引擎语音识别</h3>
          <p><strong>申请步骤：</strong></p>
          <div class="aib-vgm-steps">
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">1</span><div><strong>注册火山引擎账号</strong><p>访问 <a href="https://console.volcengine.com/" target="_blank">https://console.volcengine.com/</a>，点击"注册"。<br>⚠️ <b>建议完成实名认证</b>。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">2</span><div><strong>开通语音识别服务</strong><p>登录控制台 → 搜索"语音技术" → "语音识别" → "开通服务"。<br>选择"一句话识别"或"实时语音识别"。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">3</span><div><strong>创建应用</strong><p>在语音识别页面点击"创建应用" → 填写名称 → 平台选择 <b>"Web"</b>。<br>创建成功后获得 <b>App ID</b>。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">4</span><div><strong>获取 Access Token</strong><p>在应用详情页 → "鉴权管理" → 获取 <b>Access Token</b>（填入 API Key 字段）。</p></div></div>
            <div class="aib-vgm-step"><span class="aib-vgm-step-num">5</span><div><strong>填入小灵设置</strong><p>回到小灵设置 → 语音配置 → 引擎选择"火山引擎" → 填入 App ID 和 API Key → 保存。</p></div></div>
          </div>

          <h4>各字段含义：</h4>
          <div class="aib-vgm-table-wrap">
            <table class="aib-vgm-table">
              <thead><tr><th>字段</th><th>说明</th><th>在哪里找</th></tr></thead>
              <tbody>
                <tr><td>App ID</td><td>火山应用的唯一标识</td><td>应用详情页</td></tr>
                <tr><td>API Key</td><td>即 Access Token，接口调用凭证</td><td>鉴权管理页</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 3: 权限说明 -->
        <div v-if="activeTab === 'permission'" class="aib-vgm-content">
          <h3>🎤 麦克风权限</h3>
          <p>语音助手需要使用麦克风才能识别您的语音。</p>
          <p><strong>如何授权？</strong></p>
          <ul>
            <li>首次使用时，浏览器弹出权限请求 → 点击"允许"</li>
            <li>如果误点了"拒绝"，点击地址栏左侧 🔒 图标 → 麦克风 → 改为"允许"</li>
          </ul>
          <p class="aib-vgm-warn">⚠️ 麦克风权限是浏览器级别的。扩展的麦克风权限需要在扩展管理页面单独设置。</p>

          <hr>

          <h3>🌐 网络要求</h3>
          <div class="aib-vgm-table-wrap">
            <table class="aib-vgm-table">
              <thead><tr><th>引擎</th><th>需要的网络</th></tr></thead>
              <tbody>
                <tr><td>Web Speech API</td><td>需访问 Google 服务（国内无法直连）</td></tr>
                <tr><td>讯飞语音</td><td>国内直连</td></tr>
                <tr><td>火山引擎</td><td>国内直连</td></tr>
              </tbody>
            </table>
          </div>

          <hr>

          <h3>🔒 数据安全</h3>
          <ul>
            <li>API Key 存储在浏览器本地（chrome.storage.local），不会发送到小灵服务器</li>
            <li>音频数据仅在识别过程中临时处理，关闭语音面板后全部清除</li>
            <li>小灵本身不存储任何音频数据</li>
          </ul>
        </div>

        <!-- Tab 4: 注意事项 -->
        <div v-if="activeTab === 'tips'" class="aib-vgm-content">
          <h3>📌 使用技巧</h3>
          <ul>
            <li>默认唤醒词"你好，小灵"，可在设置中自定义</li>
            <li>说唤醒词后等待提示音，也可连续说"你好小灵打开百度"</li>
            <li>🔇 保持环境安静，🎤 麦克风距嘴 20-50cm，🗣️ 语速适中</li>
            <li>停顿 1-2 秒后自动识别为一条完整指令</li>
          </ul>

          <h3>🗣️ 指令示例</h3>
          <ul>
            <li>"打开百度" — 打开网址</li>
            <li>"搜索今天的科技新闻" — 全网搜索</li>
            <li>"点击第一个结果" — 点击页面元素</li>
            <li>"向下滚动" — 滚动页面</li>
            <li>"帮我总结这个页面" — AI 分析</li>
          </ul>

          <hr>

          <h3>⚠️ 已知限制</h3>
          <ul>
            <li><b>Web Speech API</b>：国内网络无法使用，长时间无输入会自动断开</li>
            <li><b>讯飞语音</b>：需实名认证，免费 50 万次/年</li>
            <li><b>火山引擎</b>：免费 50 万分钟，方言识别弱于讯飞</li>
            <li><b>通用</b>：嘈杂环境识别率下降，专业术语可能不准确</li>
          </ul>

          <h3>💡 最佳实践</h3>
          <ol>
            <li>海外用户 → Web Speech API；需方言 → 讯飞；大额使用 → 火山</li>
            <li>不要分享 API Key，定期在控制台查看使用量</li>
            <li>确保网络稳定，Wi-Fi 环境最佳</li>
          </ol>
        </div>

        <!-- Tab 5: 常见问题 -->
        <div v-if="activeTab === 'faq'" class="aib-vgm-content">
          <div v-for="(item, i) in faqItems" :key="i" class="aib-vgm-faq-item">
            <div class="aib-vgm-faq-q">Q: {{ item.q }}</div>
            <div class="aib-vgm-faq-a">A: {{ item.a }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aib-vgm-mask {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: var(--aib-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.aib-vgm-modal {
  width: 90vw;
  max-width: 780px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--aib-bg);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 60px var(--aib-overlay);
}

/* 标题 + Tab 合并行 */
.aib-vgm-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--aib-border);
  flex-shrink: 0;
}

.aib-vgm-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--aib-text);
  white-space: nowrap;
  flex-shrink: 0;
}

.aib-vgm-tabs {
  display: flex;
  gap: 0;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
}

.aib-vgm-tab {
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--aib-text-soft);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  white-space: nowrap;
  font-family: inherit;
}

.aib-vgm-tab:hover {
  color: var(--aib-primary);
}

.aib-vgm-tab-active {
  color: var(--aib-primary);
  border-bottom-color: var(--aib-primary);
}

.aib-vgm-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--aib-text-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}

.aib-vgm-close:hover {
  background: var(--aib-bg-hover);
  color: var(--aib-primary);
}

.aib-vgm-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.aib-vgm-content {
  font-size: 14px;
  line-height: 1.8;
  color: var(--aib-text);
}

.aib-vgm-content h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 18px 0 6px;
  color: var(--aib-text);
}

.aib-vgm-content h3:first-child {
  margin-top: 0;
}

.aib-vgm-content h4 {
  font-size: 14px;
  font-weight: 600;
  margin: 12px 0 4px;
}

.aib-vgm-content p {
  margin: 4px 0;
}

.aib-vgm-content ul, .aib-vgm-content ol {
  padding-left: 20px;
  margin: 4px 0;
}

.aib-vgm-content li {
  margin: 2px 0;
}

.aib-vgm-content a {
  color: var(--aib-primary);
  text-decoration: none;
}

.aib-vgm-content a:hover {
  text-decoration: underline;
}

.aib-vgm-content code {
  background: var(--aib-bg-card);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.aib-vgm-content hr {
  border: none;
  border-top: 1px solid var(--aib-border);
  margin: 14px 0;
}

.aib-vgm-warn {
  color: var(--aib-warning);
  font-size: 13px;
}

/* Steps */
.aib-vgm-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0;
}

.aib-vgm-step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.aib-vgm-step-num {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--aib-primary);
  color: var(--aib-text-on-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  margin-top: 3px;
}

.aib-vgm-step p {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--aib-text-soft);
}

/* Table */
.aib-vgm-table-wrap {
  overflow-x: auto;
  margin: 8px 0;
}

.aib-vgm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.aib-vgm-table th,
.aib-vgm-table td {
  border: 1px solid var(--aib-border);
  padding: 6px 10px;
  text-align: left;
}

.aib-vgm-table th {
  background: var(--aib-bg-card);
  font-weight: 600;
  white-space: nowrap;
}

/* FAQ */
.aib-vgm-faq-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--aib-border);
}

.aib-vgm-faq-item:last-child {
  border-bottom: none;
}

.aib-vgm-faq-q {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
  color: var(--aib-text);
}

.aib-vgm-faq-a {
  font-size: 13px;
  color: var(--aib-text-soft);
  line-height: 1.7;
}
</style>
