# PRD：Wasm 全量加固 + JS 混淆轮转 + 激活码商业化

## 1. 背景与目标

### 1.1 背景

当前项目（AI 浏览器助手）需要商业化分发，面临以下问题：

- **源码泄露风险**：crx 解压就是 JS，prompt 模板和业务逻辑明文暴露
- **授权无法保护**：纯前端无后端，任何付费限制、授权、会员都能被改 JS 直接破解
- **无自动更新**：自建更新需要静态文件服务器，不算后端业务服务
- **商业化需求**：需要支持免费试用 + 激活码付费模式

### 1.2 目标

1. **核心逻辑零泄露**：所有授权、校验、门控逻辑全部编译为 Wasm 二进制
2. **源码高强度混淆 + 版本轮转**：每次发布重新混淆、重编译 wasm，旧版破解工具失效
3. **激活码系统**：首次安装 7 天试用，激活后 1 个月有效
4. **隐性二次验证**：激活后仍随机触发静默校验，破解版长期使用会"出 bug"
5. **本地存储加密**：chrome.storage 中的授权信息 AES 加密，防直接篡改
6. **零业务服务器**：纯前端实现，不需要任何后端服务
7. **（可选·Phase2）远程静态黑名单**：等有用户量且出现盗版后再加，GitHub Pages 托管 JSON

### 1.3 已接受的硬短板

- 没有服务端校验 = 任何付费限制都能被改 JS 破解（Wasm + 隐性校验大幅提高门槛）
- crx 解压就是 JS，只能提高逆向成本，做不到 100% 防泄露
- 无法实现真正自动更新（需要静态托管）

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome 扩展 (JS 混淆产物, 自建 crx 分发)                     │
│                                                             │
│  ┌───────────────┐    ┌──────────────────────────────────┐  │
│  │  JS 薄壳层     │───→│  license_bg.wasm                 │  │
│  │  wasm-loader   │    │  (Rust 编译, 二进制)               │  │
│  │  - initWasm()  │    │                                  │  │
│  │  - activate()  │    │  全量逻辑都在 wasm 内:             │  │
│  │  - tick()      │    │  ├─ verify_code() 激活码校验       │  │
│  └───────┬───────┘    │  ├─ check_license() 授权状态      │  │
│          │            │  ├─ hidden_verify() 隐性二次验证    │  │
│          │            │  ├─ should_degrade() 渐进降级判断   │  │
│          │            │  ├─ encrypt() / decrypt() 加密     │  │
│          │            │  ├─ init_trial() 试用期初始化       │  │
│          │            │  ├─ feature_gate() 功能门控         │  │
│          │            │  └─ track_usage() 使用统计          │  │
│          │            └──────────────────────────────────┘  │
│          ▼                                                  │
│  ┌───────────────┐    ┌──────────────────────────────────┐  │
│  │ licenseStore   │───→│ chrome.storage.local              │  │
│  │ (Pinia)        │    │ enc_blob: AES 加密的许可证数据     │  │
│  │ - status       │    │ enc_usage: AES 加密的使用统计      │  │
│  │ - daysLeft     │    └──────────────────────────────────┘  │
│  │ - features     │                                         │
│  │ - degraded     │                                         │
│  └───────┬───────┘                                         │
│          │                                                  │
│          ▼                                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  功能门控 (wasm feature_gate 决定, JS 只读结果)         │  │
│  │  - 基础聊天: 试用期可用，过期后受限                      │  │
│  │  - 语音控制: 需要 active + 未降级                       │  │
│  │  - 网页自动化: 需要 active + 未降级                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心流程

```
用户安装扩展
    │
    ▼
首次启动
    │
    ├─ wasm init_trial(fingerprint) → 7 天试用加密 blob
    ├─ 存入 chrome.storage.local
    │
    ▼
每次启动 / 每次操作
    │
    ├─ wasm check_license(blob)        ← 解密 + 验签 + 时间检查
    ├─ wasm track_usage(action)        ← 累计使用时长/次数
    ├─ wasm hidden_verify()            ← 随机触发二次验证
    │   ├─ 通过 → 正常
    │   └─ 失败 → wasm should_degrade() → 渐进式降级
    │
    ├─ wasm feature_gate(feature)      ← 最终权限判断
    │   ├─ allowed → 正常执行
    │   └─ denied → 提示激活/已降级
    │
    └─ 返回结果给 JS 薄壳层执行
```

---

## 3. 功能需求

### 3.1 Wasm 核心模块（Rust → wasm）

#### 3.1.1 项目结构

```
wasm-license/
├── Cargo.toml
├── build.rs             # 构建脚本（读取 .build-seed 嵌入常量）
├── src/
│   ├── lib.rs           # wasm 入口，导出函数
│   ├── crypto.rs        # AES-256-CBC + HMAC-SHA256 + PBKDF2
│   ├── license.rs       # 激活码验证 + 试用期逻辑
│   ├── stealth.rs       # 隐性二次验证 + 渐进降级
│   ├── usage.rs         # 使用时长/次数统计
│   └── gate.rs          # 功能门控（综合判断）
```

#### 3.1.2 导出函数（全部逻辑在 wasm 内）

| 函数 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `init_trial(fingerprint)` | 设备指纹 | JSON `{blob, status, daysLeft}` | 初始化 7 天试用期 |
| `verify_code(code, version)` | 激活码 + 版本号 | JSON `{valid, blob, error}` | 验证激活码（绑定版本） |
| `check_license(blob)` | 加密 blob | JSON `{status, daysLeft, features, maxMessages}` | 检查授权状态 |
| `track_usage(blob, action, ts)` | blob + 动作 + 时间戳 | JSON `{totalHours, totalActions, shouldCheck}` | 使用统计 + 是否触发隐性校验 |
| `hidden_verify(blob)` | blob | JSON `{passed, degradeLevel}` | 隐性二次验证（静默） |
| `feature_gate(blob, feature, degraded)` | blob + 功能名 + 降级状态 | JSON `{allowed, reason}` | 最终功能门控 |
| `encrypt_data(data, key_seed)` | 明文 + 种子 | 加密字符串 | AES-256-CBC 加密 |
| `decrypt_data(encrypted, key_seed)` | 密文 + 种子 | 明文字符串 | AES-256-CBC 解密 |

> **可选·Phase2**：`check_blacklist(blob, bl_json)` — 远程黑名单拦截，等有用户量且出现盗版后再加

**关键原则：JS 只做调用壳，不做任何判断逻辑。所有 if/else、校验、计算都在 wasm 内部。**

#### 3.1.3 激活码格式

```
AIB-XXXX-XXXX-XXXX
├── AIB：固定前缀
├── 第 1 组 XXXX：version(1B) + expire_month(1B) + features(1B) + random(1B)
├── 第 2 组 XXXX：expire_ts 低 4 字节的 base32 编码
├── 第 3 组 XXXX：HMAC-SHA256(version + expire_ts + features, per_version_key) 前 4 字节
```

**版本绑定**：HMAC 密钥由 `master_secret + version + build_seed` 派生，激活码只能在对应版本上验证通过。
用户升级版本后需要重新激活（或生成工具支持多版本码）。

#### 3.1.4 试用期逻辑

```
首次安装:
  fingerprint = hash(chrome.runtime.id + userAgent + screen.width + screen.height + installTs)
  blob = wasm.init_trial(fingerprint)
  chrome.storage.local.set({ enc_blob: blob })

每次启动:
  blob = chrome.storage.local.get('enc_blob')
  result = wasm.check_license(blob)
  → { status: 'trial', daysLeft: 5, features: ['chat'], maxMessages: 50 }
```

#### 3.1.5 授权状态

| 状态 | 含义 | 可用功能 |
|------|------|---------|
| `trial` | 试用期内（7 天） | 基础聊天（每天 50 条），语音🔒，自动化🔒 |
| `active` | 已激活 | 全部功能（受隐性校验约束） |
| `expired` | 试用期已过，未激活 | 仅提示激活，不可使用 |

### 3.2 版本轮转机制（每次发布自动变化）

#### 3.2.1 原理

每次 `npm run build:store` 时，构建脚本自动生成随机 `build_seed`，同时影响：

1. **JS 混淆参数**：`stringArrayEncoding` 的 key、`controlFlowFlatteningThreshold`、`deadCodeInjectionThreshold` 随机微调
2. **Wasm 编译**：`build_seed` 嵌入 Rust 编译常量，影响 HMAC 派生密钥、隐性校验阈值、降级触发条件
3. **版本号自动递增**：`package.json` 的 patch 版本 +1

**效果**：
- 每个版本的混淆 JS 完全不同（破解一个版本的 deobfuscate 脚本对下一个版本无效）
- 每个版本的 wasm 二进制不同（即使提取 wasm，密钥也对不上其他版本）
- 旧版本破解后，升级新版本需要重新破解（成本持续累积）

#### 3.2.2 构建脚本流程

```
scripts/build-store.sh:

1. 生成 build_seed = random 32 字节 hex
2. 写入 .build-seed 文件
3. 递增 package.json patch 版本号
4. 读取当前版本号

5. wasm-pack build --target web --release
   (Cargo build.rs 读取 .build-seed，编译为 Rust 常量)

6. wxt build

7. node scripts/obfuscate.js --seed $build_seed
   (混淆参数基于 seed 随机微调)

8. zip -r lingbot-v$VERSION-$BUILD_SEED_SHORT.zip
```

#### 3.2.3 版本绑定激活码

```javascript
// scripts/gen-license.js
// 生成时指定目标版本
node gen-license.js --version 1.3.2 --days 30 --features voice,automation

// wasm 验证时检查版本
// verify_code("AIB-XXXX-XXXX-XXXX", "1.3.2")
// → HMAC(version="1.3.2") 匹配 → valid
// → 用在 v1.3.1 上 → HMAC(version="1.3.1") 不匹配 → invalid
```

### 3.3 隐性二次验证（防破解长期使用）

#### 3.3.1 机制

wasm 内部维护使用统计，随机触发静默校验：

```
触发条件（全部在 wasm 内计算，用户无法预测）：
  - 累计使用时长达到随机阈值（48-96 小时之间，每次安装不同）
  - 累计操作次数达到随机阈值（300-800 次之间）
  - 距离上次校验超过随机时间（24-72 小时）

触发时：
  wasm.hidden_verify(blob)
  ├─ 重新计算 fingerprint → 与 blob 中存储的对比
  ├─ 重新验证 blob HMAC 签名
  ├─ 检查使用时长是否合理（不能凭空跳变）
  └─ 返回 { passed: true/false, degradeLevel: 0-3 }
```

#### 3.3.2 渐进式降级（看起来像 bug，不像防破解）

**不弹任何提示，不告诉用户"验证失败"**。降级是渐进的、随机的，让用户以为是网络问题或 AI 服务不稳定：

| 降级等级 | 表现 | 用户感知 |
|---------|------|---------|
| Level 0 | 正常 | 无感知 |
| Level 1 | AI 回复前随机延迟 3-8 秒 | "网络有点慢" |
| Level 2 | 10% 概率返回"AI 响应异常，请重试" | "服务不太稳定" |
| Level 3 | 30% 概率失败 + 功能偶尔不可用 | "这软件 bug 太多" |

**降级状态持久化**：写入加密 blob，wasm 每次启动读取。只有重新激活有效激活码才能清除降级。

#### 3.3.3 JS 薄壳层调用

```typescript
// src/license/wasm-loader.ts
// 每次用户操作（发送消息、执行命令）时调用
function tick(action: 'chat' | 'voice' | 'automation') {
  const usage = JSON.parse(track_usage(blob, action, Date.now()));
  if (usage.shouldCheck) {
    // 静默校验，不通知用户
    const verify = JSON.parse(hidden_verify(blob));
    if (!verify.passed) {
      // 更新降级状态，用户无感知
      degradeLevel = verify.degradeLevel;
    }
  }
}
```

### 3.4 （可选·Phase2）远程静态黑名单

> **暂不实施**，等有用户量且出现盗版后再加。不影响主流程。

<details>
<summary>展开查看方案设计（备忘）</summary>

**原理**：GitHub Pages 托管 `blacklist.json`，wasm 读取并拦截盗版机器码/泄露激活码。

**`blacklist.json` 结构**：
```json
{
  "blockedFingerprints": ["a1b2c3d4..."],
  "blockedCodes": ["AIB-XK3M-P7N2-R9TQ"],
  "minVersion": "1.3.1"
}
```

**流程**：JS fetch JSON → 传入 wasm → 验签 + 匹配 → 命中则锁定

**管理**：编辑 JSON → 提交 GitHub → 自动生效

**注意**：破解者可删掉 JS 中的 fetch 调用绕过，因此这只是辅助手段。

</details>

### 3.5 全量 Wasm 逻辑（JS 只做薄壳）

#### 3.5.1 Wasm 内部模块

```
license_bg.wasm 内部:
├── crypto.rs        AES-256-CBC + HMAC-SHA256 + PBKDF2 密钥派生
├── license.rs       激活码验证 + 试用期初始化 + 授权状态管理
├── stealth.rs       隐性校验触发器 + 渐进降级状态机
├── usage.rs         使用时长/次数统计（加密存储）
└── gate.rs          功能门控（综合所有因素的最终判断）
```

#### 3.5.2 JS 薄壳层职责（极简）

```typescript
// src/license/wasm-loader.ts — JS 只做这些事：
// 1. 加载 wasm 模块
// 2. 从 chrome.storage 读取加密 blob → 传给 wasm
// 3. 调用 wasm 函数 → 读取返回结果
// 4. 用户操作时调用 tick() → wasm 内部统计
// 5. 把 wasm 返回的状态暴露给 Vue 组件

// 不做任何 if/else 判断，不做任何校验逻辑
// 所有判断都在 wasm 内部完成
```

### 3.6 JS 混淆（自建 crx 分发 + 版本轮转）

#### 3.6.1 混淆配置（基于 build_seed 随机微调）

```javascript
// scripts/obfuscate.js
const seed = process.argv.find(a => a.startsWith('--seed='))?.split('=')[1];
const rng = seedRng(seed);  // 基于 seed 的确定性随机

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6 + rng() * 0.3,  // 0.6~0.9 随机
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2 + rng() * 0.3,      // 0.2~0.5 随机
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.6 + rng() * 0.3,             // 0.6~0.9 随机
  transformObjectKeys: true,
  splitStrings: true,
  splitStringsChunkLength: 6 + Math.floor(rng() * 8),  // 6~13 随机
};
```

#### 3.6.2 混淆目标

构建产物中所有 `.js` 文件：
- `background.js`
- `content-scripts/content.js`

### 3.7 本地存储加密

#### 3.7.1 存储结构

```javascript
chrome.storage.local.get(['enc_blob', 'enc_usage'])
// enc_blob:  "U2FsdGVkX1+..."  ← AES 加密的许可证数据
// enc_usage: "U2FsdGVkX1+..."  ← AES 加密的使用统计
```

**`enc_blob` 解密后**：
```json
{
  "status": "active",
  "installTs": 1735689600000,
  "expireTs": 1738368000000,
  "fingerprint": "a1b2c3d4...",
  "features": ["chat", "voice", "automation"],
  "maxMessages": -1,
  "hmac": "...",
  "degradeLevel": 0,
  "lastHiddenCheck": 1735776000000
}
```

**`enc_usage` 解密后**：
```json
{
  "totalHours": 12.5,
  "totalActions": 342,
  "dailyUsed": 8,
  "dailyResetDate": "2026-06-28",
  "lastTickTs": 1735776000000,
  "nextCheckThreshold": 67.3
}
```

#### 3.7.2 防篡改机制

- AES 密钥由 wasm 内部派生，JS 层不可见
- 每个 blob 都有 HMAC 签名，wasm 解密后先验签
- 指纹绑定：换设备后试用期不继承
- 时间合理性检查：expireTs 不能早于 installTs，不能超过合理范围
- 使用统计防跳变：totalHours 不能凭空增加（与实际 tick 频率对比）

### 3.8 激活码生成工具

#### 3.8.1 工具文件

`scripts/gen-license.js` — 私有脚本，不随扩展分发

```bash
# 生成 100 个 30 天激活码（绑定版本 1.3.2）
node scripts/gen-license.js --version 1.3.2 --count 100 --days 30 --features voice,automation

# 输出 licenses.csv
# AIB-XK3M-P7N2-R9TQ,1.3.2,2026-07-28,voice|automation
# AIB-L5F8-W2J6-H4Y1,1.3.2,2026-07-28,voice|automation
```

#### 3.8.2 销售渠道

| 渠道 | 地区 | 收款 | 自动发码 |
|------|------|------|---------|
| Gumroad | 海外 | 信用卡/PayPal | ✅ 邮箱自动发码 |
| 爱发电 | 国内 | 支付宝 | ✅ 自动发码（需配置） |
| 手动分发 | 全球 | 微信/红包 | ❌ 手动 |

---

## 4. 文件变更清单

### 4.1 新增文件（15 个）

| 文件 | 用途 |
|------|------|
| `wasm-license/Cargo.toml` | Rust crate 配置 |
| `wasm-license/build.rs` | 构建脚本（读取 .build-seed 嵌入常量） |
| `wasm-license/src/lib.rs` | wasm 主入口，导出函数 |
| `wasm-license/src/crypto.rs` | AES-256-CBC + HMAC-SHA256 + PBKDF2 |
| `wasm-license/src/license.rs` | 激活码验证 + 试用期逻辑 |
| `wasm-license/src/stealth.rs` | 隐性二次验证 + 渐进降级状态机 |
| `wasm-license/src/usage.rs` | 使用时长/次数统计 |
| `wasm-license/src/gate.rs` | 功能门控（综合判断） |
| `public/wasm/license.js` | wasm-bindgen 生成的 JS 胶水层（构建产物） |
| `public/wasm/license_bg.wasm` | Rust 编译的 wasm 二进制（构建产物） |
| `src/license/wasm-loader.ts` | JS 加载 wasm 的封装层（薄壳） |
| `src/stores/license.ts` | Pinia license store（状态管理） |
| `scripts/obfuscate.js` | JS 混淆脚本（版本轮转） |
| `scripts/gen-license.js` | 激活码生成工具（私有，不分发） |
| `scripts/build-store.sh` | 完整构建脚本（wasm + wxt + 混淆 + zip） |

### 4.2 修改文件（8 个）

| 文件 | 改动内容 |
|------|---------|
| `wxt.config.ts` | `web_accessible_resources` 添加 `wasm/*.js` + `wasm/*.wasm` |
| `package.json` | 添加 `javascript-obfuscator` 依赖 + 构建脚本 |
| `entrypoints/content/App.vue` | `onMounted` 时初始化 `licenseStore.init()` |
| `entrypoints/content/components/SettingsModal.vue` | 实现 `activateLicense()`，接入 licenseStore |
| `src/voice/voice-manager.ts` | `start()` 方法开头调用 `tick('voice')` + `feature_gate` |
| `src/input/pipeline.ts` | `executeCommand()` 调用 `tick('automation')` + `feature_gate` |
| `src/i18n/zh-CN.json` | 新增 license 相关文案 |
| `src/i18n/en-US.json` | 同上英文版 |

### 4.3 不修改的文件

| 文件 | 原因 |
|------|------|
| 所有 Vue 组件（除 SettingsModal） | UI 层不需要改 |
| `src/adapters/*.ts` | AI 适配器不受授权影响 |
| `src/browser/action-executor.ts` | DOM 操作由 pipeline 门控 |
| `src/voice/web-speech-engine.ts` | 纯浏览器 API |
| `src/voice/broadcast.ts` | TTS 播报 |
| `src/voice/wake-word.ts` | 唤醒词检测 |
| `src/input/tag-parser.ts` | 标签解析 |
| `src/input/prompts/*.ts` | Prompt 模板 |
| `src/utils/*.ts` | 工具函数 |

---

## 5. 实施计划

### 第 1 天：Rust Wasm 模块

1. 安装 Rust 工具链（rustup + wasm-pack + wasm32 target）
2. 创建 `wasm-license/` crate
3. 实现 `crypto.rs`（AES-256-CBC + HMAC-SHA256 + PBKDF2）
4. 实现 `license.rs`（激活码验证 + 试用期逻辑）
5. 实现 `usage.rs`（使用统计）
6. 实现 `stealth.rs`（隐性验证 + 降级）
7. 实现 `gate.rs`（功能门控）
8. 实现 `build.rs`（读取 build-seed 嵌入常量）
9. `wasm-pack build --target web --release` 编译

### 第 2 天：JS 集成

1. 创建 `src/license/wasm-loader.ts`（wasm 薄壳加载层）
2. 创建 `src/stores/license.ts`（Pinia store）
3. 修改 `entrypoints/content/App.vue`（初始化 license）
4. 修改 `SettingsModal.vue`（实现 activateLicense）
5. 修改 `wxt.config.ts`（添加 wasm 资源声明）
6. 测试：试用期初始化、激活码验证、状态切换

### 第 3 天：功能门控 + 隐性校验

1. 修改 `src/voice/voice-manager.ts`（语音门控 + tick）
2. 修改 `src/input/pipeline.ts`（自动化门控 + tick）
3. 测试：隐性二次验证触发、渐进降级效果
4. 修改 `src/i18n/zh-CN.json` + `en-US.json`

### 第 4 天：混淆 + 版本轮转 + 打包

1. `npm install javascript-obfuscator --save-dev`
2. 创建 `scripts/obfuscate.js`（版本轮转混淆）
3. 创建 `scripts/build-store.sh`（完整构建流程）
4. 创建 `scripts/gen-license.js`（激活码生成）
5. 修改 `package.json`（添加脚本）
6. 测试 `npm run build:store` 完整流程

### 第 5 天：测试 + 上架

1. 完整 E2E 测试：安装 → 试用 → 激活 → 过期 → 重新激活
2. 测试篡改 storage → wasm 校验失败
3. 测试换设备 → 试用期不继承
4. 测试隐性降级（长时间使用后）
5. 测试版本轮转（连续构建两次，产物不同）
6. 准备分发材料
7. 上传 GitHub Releases / 蓝奏云

---

## 6. 成本

| 项目 | 费用 |
|------|------|
| Rust 工具链 | 免费 |
| wasm-pack | 免费 |
| javascript-obfuscator | 免费 |
| Gumroad | 免费（抽成 10%） |
| 爱发电 | 免费（抽成 5-6%） |
| GitHub Releases | 免费 |
| 蓝奏云 | 免费 |
| **总计** | **¥0** |

---

## 7. 验收标准

### 基础功能
- [ ] `npm run build:store` 成功编译完整产物
- [ ] 首次安装自动进入 7 天试用期
- [ ] 试用期只能使用基础聊天（每天 50 条），语音和自动化显示🔒
- [ ] 输入有效激活码后，status 变为 active，所有功能解锁
- [ ] 激活码过期后，功能降级回 expired 状态

### 加密与防篡改
- [ ] chrome.storage.local 中的 license 数据是 AES 加密的，无法直接读取
- [ ] 手动修改 chrome.storage 中的加密数据后，wasm 校验失败
- [ ] 换设备（不同 fingerprint）后试用期不继承

### 版本轮转
- [ ] 连续运行两次 `npm run build:store`，产出的 JS 混淆结果不同
- [ ] 连续运行两次，产出的 wasm 二进制不同（build_seed 不同）
- [ ] 旧版本激活码在新版本上验证失败

### 隐性二次验证
- [ ] 激活后累计使用一定时长/次数后，wasm 触发 hidden_verify
- [ ] 验证失败时渐进降级（延迟、随机失败），无任何提示
- [ ] 降级状态持久化，重启后仍保持

### 混淆与打包
- [ ] 混淆后的扩展能正常安装和运行
- [ ] 混淆后 JS 可读性极低（变量名随机、控制流扁平化、死代码注入）
- [ ] wasm 二进制无法直接阅读

---

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Rust 工具链安装复杂 | 开发环境搭建慢 | 提供详细安装文档；备选 AssemblyScript |
| wasm 被提取逆向 | 核心逻辑泄露 | 混淆 + wasm 双重保护 + 版本轮转 |
| 用户篡改时间戳 | 绕过试用期 | wasm 检查时间合理性 + 隐性验证 |
| 激活码被批量生成 | 收入损失 | HMAC 在 wasm 中 + 版本绑定 |
| wasm 增加扩展体积 | 下载变慢 | `opt-level = "s"` + LTO + strip，预期 < 100KB |
| Chrome 沙箱兼容性 | 扩展崩溃 | 不开 selfDefending / debugProtection |
| 用户改 JS 绕过门控 | 免费用付费功能 | 全量逻辑在 wasm，JS 只是调用壳 |
| 隐性降级被用户发现 | 差评 | 降级表现像自然 bug，不暴露防破解意图 |
| 旧版本被长期使用 | 安全风险 | 版本轮转 + 激活码绑定版本号 |

---

## 9. 备选方案：AssemblyScript

如果 Rust 工具链安装困难，可用 AssemblyScript 替代：

| 对比 | Rust → wasm | AssemblyScript → wasm |
|------|------------|----------------------|
| 语法 | Rust（学习曲线陡） | TypeScript-like（前端友好） |
| 工具链 | rustup + wasm-pack | npm install assemblyscript |
| wasm 体积 | ~50-80KB | ~30-50KB |
| 安全性 | 更高（内存安全 + 编译优化） | 较高（wasm 层面等价） |
| 开发速度 | 较慢 | 较快 |

**结论**：优先 Rust，如果环境搞不定就切 AssemblyScript。两者产出的 wasm 在逆向难度上没有本质区别。
