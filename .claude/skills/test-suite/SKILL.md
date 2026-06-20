# Test Suite — 功能测试生成与执行

自动扫描项目代码、分析功能模块、生成功能测试用例、执行测试并输出功能测试报告。

## 触发

用户输入 `/test-suite` 时执行。

---

## 执行流程

### Step 1: 检测运行模式

检查 `vitest.config.ts` 是否存在：

- **不存在** → 首次模式（Step 2 + Step 3 + Step 4 + Step 5）
- **存在** → 增量模式（Step 3 + Step 4 + Step 5，跳过 Step 2）

---

### Step 2: 基础设施搭建（仅首次）

#### 2.1 安装依赖

```bash
npm install -D vitest @vitest/coverage-v8 happy-dom
```

#### 2.2 创建 vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/types.ts',
        'src/themes.ts',
      ],
    },
  },
})
```

#### 2.3 创建 test/setup.ts

全局 chrome.* API mock，包含：
- `chrome.runtime`（sendMessage、onMessage、connect、id、getURL）
- `chrome.storage.local`（get、set、remove、clear）
- `chrome.storage.sync`（get、set、remove）
- `chrome.storage.onChanged`
- `chrome.tabs`（query、sendMessage、create、update、remove）
- `chrome.scripting`（executeScript）
- `chrome.action`（setBadgeText、setBadgeBackgroundColor、setIcon）
- `chrome.permissions`（request、contains）
- `SpeechRecognition` / `webkitSpeechRecognition`
- `speechSynthesis`
- `URL.createObjectURL` / `URL.revokeObjectURL`
- `matchMedia`

#### 2.4 确认 package.json 包含 test 脚本

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

---

### Step 3: 功能分析与测试生成

#### 3.1 扫描项目功能模块

**首次模式**：扫描 `src/` 下所有目录，识别功能模块

```bash
find src/ -type d ! -path "*/__tests__/*" ! -path "*/node_modules/*"
```

**增量模式**：获取变更文件所属模块

```bash
git diff HEAD~1 --name-only -- "src/**/*.ts" 2>/dev/null | grep -v "\.test\.ts$" | grep -v "types\.ts"
```

#### 3.2 分析每个功能模块

对每个模块，读取源文件分析：

**A. 识别模块的核心功能（不是函数/方法，是业务功能）**

例如：
- `input/router.ts` → 功能：输入路由（内置命令 vs AI 处理）
- `input/tag-parser.ts` → 功能：标签解析（从 AI 回复提取指令）
- `browser/skeleton.ts` → 功能：骨架提取（识别页面可交互元素）
- `browser/action-executor.ts` → 功能：命令执行（执行浏览器操作）
- `adapters/openai.ts` → 功能：AI 对话（调用 OpenAI API）

**B. 分析每个功能的完整业务流程**

例如"输入路由"功能：
1. 用户输入文本
2. 检查是否以 `/` 开头
3. 如果是内置命令 → 直接执行
4. 如果是其他 → 交给 AI 处理

**C. 设计功能测试场景**

每个功能设计多个场景，每个场景包含多个步骤：
- 场景：用户正常操作
- 场景：用户异常操作
- 场景：边界条件

#### 3.3 生成功能测试文件

**文件路径**：`src/__tests__/functional-test.test.ts`

**测试结构**：

```typescript
/**
 * 功能测试 - 完整业务流程测试
 *
 * 测试目标：验证每个核心功能的完整业务流程
 * 测试方法：模拟用户真实操作场景，验证每一步的正确性
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════
// 功能 1: XXX功能
// ═══════════════════════════════════════════════════════════════

describe('功能 1: XXX功能', () => {
  describe('场景 1.1: 正常操作', () => {
    it('步骤 1: 用户执行XXX操作', () => {
      // 准备数据
      // 执行操作
      // 验证结果
    })

    it('步骤 2: 系统返回XXX结果', () => {
      // 验证下一步
    })
  })

  describe('场景 1.2: 异常操作', () => {
    it('步骤 1: 用户输入无效数据', () => {
      // 验证错误处理
    })
  })
})
```

#### 3.4 测试用例编写规范

**测试组织方式**：
- 按功能模块分组（功能 1、功能 2...）
- 每个功能下按场景分组（场景 1.1、场景 1.2...）
- 每个场景下按步骤分组（步骤 1、步骤 2...）

**测试命名规范**：
- 功能：`功能 X: 功能名称`
- 场景：`场景 X.Y: 场景描述`
- 步骤：`步骤 N: 操作描述`

**测试内容**：
- 每个步骤都要说明：操作、预期结果、实际结果
- 正常流程测试
- 异常流程测试
- 边界条件测试

**Mock 策略**：
| 依赖类型 | Mock 方式 |
|---------|----------|
| chrome.* API | 全局 mock（test/setup.ts 已提供） |
| 同项目模块 | `vi.mock('./module')` |
| wxt/storage | `vi.mock('wxt/storage')` |
| DOM 操作 | happy-dom 自动提供 |
| 网络请求 | `vi.fn()` mock fetch |

---

### Step 4: 执行测试

```bash
npx vitest run --reporter=json 2>/dev/null
```

捕获 JSON 输出，解析测试结果。

如果测试执行失败（编译错误等），分析错误原因并修复测试代码后重试。最多重试 2 次。

---

### Step 5: 生成功能测试报告

将报告写入 `docs/functional-test-report.md`，格式如下：

```markdown
# 功能测试报告

> 生成时间：YYYY-MM-DD HH:mm:ss
> 运行模式：首次 / 增量
> 变更模块：（增量模式下列出）

## 📊 测试摘要

| 指标 | 值 |
|------|-----|
| 总功能数 | N |
| 总场景数 | N |
| 总用例数 | N |
| 通过 | N ✅ |
| 失败 | N ❌ |
| 通过率 | XX% |
| 执行耗时 | Xs |

---

## 🎯 功能 1: XXX功能

**功能描述**：XXX

### 场景 1.1: 正常操作

| 步骤 | 操作 | 预期结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 用户执行XXX | XXX | XXX | ✅ |
| 2 | 系统返回XXX | XXX | XXX | ✅ |

### 场景 1.2: 异常操作

| 步骤 | 操作 | 预期结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| 1 | 用户输入无效数据 | 返回错误 | 返回错误 | ✅ |

---

## 🎯 功能 2: XXX功能

...

---

## 📋 测试覆盖的功能点

### ✅ 已覆盖功能

1. **XXX功能**
   - 功能点 1
   - 功能点 2

---

## 📊 测试统计

| 功能 | 场景数 | 用例数 | 通过 | 失败 |
|------|--------|--------|------|------|
| 功能 1 | N | N | N | 0 |
| 功能 2 | N | N | N | 0 |
| **总计** | **N** | **N** | **N** | **0** |

---

## ✅ 测试结论

（总结测试结果，列出验证的功能）
```

---

## 注意事项

1. **功能测试，不是接口测试**：测试业务流程，不是测试函数/方法
2. **场景驱动**：每个功能按真实业务场景组织
3. **步骤验证**：每个场景分解为多个步骤，逐步验证
4. **覆盖完整**：要覆盖整个项目的所有核心功能模块
5. **首次运行耗时较长**：需要分析整个项目并生成测试，预计 5-10 分钟
6. **增量运行更快**：只重新生成变更模块的测试
7. **测试文件会被覆盖**：每次运行会重新生成测试文件，手动修改会丢失
8. **报告每次覆盖**：docs/functional-test-report.md 每次运行都会被最新报告覆盖

---

## 快捷操作

- `/test-suite` — 完整流程（分析项目 → 生成功能测试 → 执行 → 报告）
- 用户可以说"只测试 XXX 模块"来限定范围
- 用户可以说"跳过生成直接执行"来只运行现有测试

---

## 项目功能模块参考

以下是常见项目的功能模块划分：

### Chrome 扩展项目
- 输入处理（路由、意图检测、指令解析）
- 浏览器操作（骨架提取、命令执行、页面交互）
- AI 对话（适配器、提示词、流式响应）
- 语音功能（识别、会话、播报）
- 存储管理（会话、设置、历史）
- 翻译功能（划词翻译、批量翻译）

### Web 应用项目
- 用户认证（登录、注册、权限）
- 数据管理（CRUD、搜索、分页）
- 页面交互（表单、弹窗、导航）
- 状态管理（全局状态、本地存储）
- API 调用（请求、响应、错误处理）

### Node.js 服务项目
- 请求处理（路由、中间件、参数验证）
- 业务逻辑（核心功能、数据处理）
- 数据访问（数据库、缓存、文件）
- 外部集成（第三方 API、消息队列）
