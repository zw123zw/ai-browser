# Test Suite — 自动化测试生成与执行

自动扫描项目代码、生成/更新测试用例、执行测试并输出测试报告。

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
    include: ['src/**/*.test.ts'],
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

### Step 3: 扫描与生成测试

#### 3.1 获取目标文件列表

**首次模式**：扫描 `src/` 下所有 `.ts` 文件（排除 `.test.ts`、`types.ts`、`__tests__/`）

```bash
find src/ -name "*.ts" ! -name "*.test.ts" ! -name "types.ts" ! -path "*/__tests__/*"
```

**增量模式**：获取变更文件

```bash
git diff HEAD~1 --name-only -- "src/**/*.ts" 2>/dev/null | grep -v "\.test\.ts$" | grep -v "types\.ts"
```

如果 `git diff HEAD~1` 失败（如首次 commit，无父提交），回退为全量扫描模式。

如果没有变更文件，跳过生成，直接到 Step 4。

#### 3.2 逐模块生成测试

对每个目标文件，执行以下流程：

**A. 读取源文件**

使用 Read 工具读取文件内容。

**B. 分析模块**

识别以下内容：
- 导出的函数、类、常量
- 函数参数类型和返回类型
- 外部依赖（import 语句）
- 分支逻辑（if/else、switch、三元）
- 错误处理（try/catch、throw）

**C. 生成测试文件**

文件路径：与源文件同目录，文件名加 `.test.ts` 后缀。
- `src/utils/cache.ts` → `src/utils/cache.test.ts`
- `src/adapters/openai.ts` → `src/adapters/openai.test.ts`

**D. 测试用例编写规范**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { functionUnderTest } from './source-file'

// 如果需要 mock 外部依赖
vi.mock('./dependency', () => ({
  someFunction: vi.fn(),
}))

describe('functionUnderTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 正常用例
  it('应处理正常输入', () => {
    const result = functionUnderTest('input')
    expect(result).toBe('expected')
  })

  // 边界条件
  it('应处理空输入', () => {
    const result = functionUnderTest('')
    expect(result).toBe('')
  })

  // 错误输入
  it('应抛出错误当输入无效', () => {
    expect(() => functionUnderTest(null)).toThrow()
  })

  // 分支覆盖
  it('应走 else 分支当条件不满足', () => {
    const result = functionUnderTest('special')
    expect(result).toBe('special-result')
  })
})
```

**E. 用例数量指南**

| 模块复杂度 | 用例数 | 判断标准 |
|-----------|--------|---------|
| 简单 | 3-5 | 单函数，无分支 |
| 中等 | 5-10 | 多函数或有分支逻辑 |
| 复杂 | 10-20 | 多函数 + 复杂分支 + 外部依赖 |

**F. Mock 策略**

| 依赖类型 | Mock 方式 |
|---------|----------|
| chrome.* API | 全局 mock（test/setup.ts 已提供） |
| 同项目模块 | `vi.mock('./module')` |
| wxt/storage | `vi.mock('wxt/storage')` |
| DOM 操作 | happy-dom 自动提供 |
| 网络请求 | `vi.fn()` mock fetch |
| 流式响应 | mock ReadableStream |

---

### Step 4: 执行测试

```bash
npx vitest run --reporter=json --coverage 2>/dev/null
```

捕获 JSON 输出，解析测试结果。

如果测试执行失败（编译错误等），分析错误原因并修复测试代码后重试。最多重试 2 次。

如果 `--coverage` 导致性能问题或兼容错误，可降级为不带覆盖率运行：
```bash
npx vitest run --reporter=json 2>/dev/null
```

---

### Step 5: 生成测试报告

将报告写入 `docs/test-report.md`，格式如下：

```markdown
# 测试报告

> 生成时间：YYYY-MM-DD HH:mm:ss
> 运行模式：首次 / 增量
> 变更模块：（增量模式下列出）

## 📊 摘要

| 指标 | 值 |
|------|-----|
| 总用例数 | N |
| 通过 | N ✅ |
| 失败 | N ❌ |
| 跳过 | N ⏭️ |
| 通过率 | XX% |
| 行覆盖率 | XX% |
| 函数覆盖率 | XX% |
| 执行耗时 | Xs |

## 📁 模块详情

### src/utils/cache.ts
- 测试文件：cache.test.ts
- 用例数：5 | 通过：5 | 失败：0
- 覆盖率：行 95% | 函数 100%

### src/adapters/openai.ts
- 测试文件：openai.test.ts
- 用例数：8 | 通过：6 | 失败：2
- 覆盖率：行 72% | 函数 80%

## ❌ 失败用例

### src/adapters/openai.test.ts > streamChat > 应处理网络超时
- 错误：Expected timeout error but got undefined
- 建议：检查 mock 的 AbortController 实现

## 🔧 修复建议

（如有失败用例，给出具体修复建议）
```

---

## 注意事项

1. **首次运行耗时较长**：需要为 50+ 个文件生成测试，预计 5-10 分钟
2. **增量运行更快**：只重新生成变更模块的测试
3. **测试文件会被覆盖**：每次运行会重新生成变更模块的测试文件，手动修改会丢失
4. **Vue 组件暂不测试**：组件测试需要额外的 Shadow DOM 配置，复杂度高
5. **chrome.* mock 持续维护**：如果项目新增 chrome API 使用，需要更新 test/setup.ts
6. **失败重试**：测试执行失败时会自动分析原因并修复，最多重试 2 次
7. **报告每次覆盖**：docs/test-report.md 每次运行都会被最新报告覆盖

---

## 快捷操作

- `/test-suite` — 完整流程（检测模式 → 生成 → 执行 → 报告）
- 用户可以说"只测试 utils 模块"来限定范围
- 用户可以说"跳过生成直接执行"来只运行现有测试
