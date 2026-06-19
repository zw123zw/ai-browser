# test-suite: 自动化测试生成与执行技能

## Goal

创建一个 Claude Code 技能 `/test-suite`，每次调用时自动扫描项目代码、生成/更新测试用例、执行测试并输出一份测试报告。首次运行生成全量测试，后续运行基于代码变更增量更新。

---

## Requirements

### 核心需求

1. **技能形式**：Claude Code 技能（`.claude/skills/test-suite/SKILL.md`），通过 `/test-suite` 触发
2. **全量覆盖**：覆盖 src/ 下所有模块 — adapters、automation、browser、composables、input、storage、stores、utils、voice、themes.ts、types.ts
3. **测试文件位置**：与源码同目录（`src/utils/cache.test.ts`）
4. **测试报告**：`docs/test-report.md`，摘要 + 详细（每个模块结果 + 失败分析）
5. **增量更新**：后续运行基于 `git diff` 检测变更，只重新生成变更模块的测试

### 首次运行流程

```
1. 检测是否首次运行（无 vitest.config.ts → 首次）
2. 安装依赖：vitest + @vitest/coverage-v8 + happy-dom
3. 创建 vitest.config.ts
4. 创建 test/setup.ts（chrome.* API 全局 mock）
5. 更新 package.json（添加 test/test:watch/test:coverage 脚本）
6. 扫描 src/ 全部 .ts/.vue 文件
7. AI 逐模块分析 → 生成 .test.ts 文件
8. 执行 npx vitest run --reporter=json
9. 解析结果 → 生成 docs/test-report.md
```

### 后续运行流程

```
1. 检测已有 vitest.config.ts → 非首次
2. git diff HEAD~1 --name-only 检测变更文件
3. 对每个变更的源文件，重新生成对应的 .test.ts
4. 执行 npx vitest run --reporter=json
5. 解析结果 → 更新 docs/test-report.md
```

### 测试生成策略

每个模块的测试生成遵循：

1. **读取源文件** → 分析导出的函数/类/类型
2. **分析函数签名** → 确定输入输出类型
3. **生成用例类别**：
   - 正常输入 → 预期输出
   - 边界条件（空值、零值、极大值）
   - 错误输入（类型错误、格式错误）
   - 分支覆盖（if/else、switch）
4. **Mock 策略**：
   - 纯函数：无需 mock
   - chrome.* 依赖：使用全局 mock
   - 外部依赖（wxt/storage 等）：vi.mock()
   - DOM 操作：happy-dom 环境

---

## Acceptance Criteria

- [ ] `/test-suite` 首次运行：安装依赖 → 生成全量测试 → 执行 → 输出报告
- [ ] `/test-suite` 后续运行：检测变更 → 更新测试 → 执行 → 更新报告
- [ ] `docs/test-report.md` 包含：通过率摘要、覆盖率、每模块详情、失败分析
- [ ] 测试文件与源码同目录（`src/utils/cache.test.ts`）
- [ ] chrome.* API mock 全局可用（test/setup.ts）
- [ ] Vitest 配置正确（路径别名 @/ 、TypeScript、happy-dom）
- [ ] `npm test` 可独立运行（不依赖 Claude Code）
- [ ] 测试运行时间 < 60 秒

---

## Definition of Done

- `.claude/skills/test-suite/SKILL.md` 创建完成
- vitest + happy-dom + @vitest/coverage-v8 安装完成
- vitest.config.ts 配置完成（路径别名、happy-dom、覆盖率）
- test/setup.ts 创建完成（chrome.* mock）
- package.json 更新（test 脚本）
- 首次运行生成全部测试文件
- `npm test` 全部通过
- `docs/test-report.md` 生成

---

## Out of Scope

- **E2E 测试**：需要真实浏览器环境，不在本技能范围
- **视觉回归测试**：截图对比，不适用
- **性能基准测试**：不适用
- **测试用例的手动编辑**：技能每次覆盖生成，手动修改会被覆盖
- **CI/CD 集成**：后续可单独配置

---

## Technical Approach

### 技能结构

```
.claude/skills/test-suite/
└── SKILL.md          # 技能指令文件
```

### SKILL.md 核心逻辑

```markdown
# Test Suite — 自动化测试生成与执行

## 触发
输入 /test-suite 运行

## 步骤

### Step 1: 检测运行模式
- 检查 vitest.config.ts 是否存在
- 存在 → 增量模式
- 不存在 → 首次模式

### Step 2: 基础设施（仅首次）
- npm install -D vitest @vitest/coverage-v8 happy-dom
- 创建 vitest.config.ts
- 创建 test/setup.ts（chrome mock）
- 更新 package.json scripts

### Step 3: 扫描与生成
- 首次：扫描 src/ 全部 .ts/.vue 文件
- 增量：git diff HEAD~1 --name-only 获取变更文件列表
- 对每个文件：
  1. Read 源文件
  2. 分析导出函数、类型、依赖
  3. 生成对应的 .test.ts 文件
  4. Write 到同目录

### Step 4: 执行测试
- npx vitest run --reporter=json --coverage
- 解析 JSON 结果

### Step 5: 生成报告
- 写入 docs/test-report.md
- 格式：摘要 + 模块详情 + 失败分析
```

### 依赖安装

```bash
npm install -D vitest @vitest/coverage-v8 happy-dom
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

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
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
})
```

### test/setup.ts（chrome.* 全局 mock）

```typescript
import { vi } from 'vitest'

// chrome.runtime
globalThis.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    connect: vi.fn(),
    id: 'test-extension-id',
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    create: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([]),
  },
} as any
```

### 测试报告模板

```markdown
# 测试报告

> 生成时间：YYYY-MM-DD HH:mm:ss
> 运行模式：首次 / 增量

## 📊 摘要

| 指标 | 值 |
|------|-----|
| 总用例数 | N |
| 通过 | N |
| 失败 | N |
| 跳过 | N |
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

1. [adapters/openai] streamChat 的超时处理需要补充 AbortSignal mock
2. [stores/conversations] migrate 需要测试旧版本数据格式
```

---

## Decision (ADR-lite)

**Context**: 项目零测试基础设施，需要一个可重复执行的技能来自动生成和维护测试。

**Decision**: 使用 Claude Code 技能（SKILL.md）+ Vitest 框架。技能负责 AI 生成测试代码，Vitest 负责执行。首次全量生成，后续 git diff 增量更新。

**Consequences**:
- 测试代码由 AI 生成，质量取决于模型能力，可能需要人工审查关键模块
- 每次运行会覆盖之前的测试文件，手动修改不可持久化
- Vitest 与 WXT/Vite 生态完美兼容，零配置摩擦
- chrome.* mock 需要持续维护以匹配项目实际使用的 API

---

## Technical Notes

- WXT 底层是 Vite，Vitest 共享配置，无需额外适配
- 项目 `tsconfig.json` extends `.wxt/tsconfig.json`，Vitest 需要独立的 resolve 配置
- `@/` 路径别名需要在 vitest.config.ts 中配置
- `src/storage/index.ts` 依赖 `wxt/storage`，需要 vi.mock()
- `src/adapters/proxy.ts` 依赖 `chrome.runtime.sendMessage`，需要全局 mock
- happy-dom 比 jsdom 快 2-3x，且 API 更完整
- Vue 组件测试需要额外配置 Shadow DOM 挂载，复杂度较高，首次可先跳过组件测试
- 测试报告放在 `docs/test-report.md`，与项目文档体系一致

---

## Research References

- 旧 PRD：`.trellis/tasks/06-15-test-suite/prd.md`（Vitest 选型分析、测试用例清单）
- Vitest 官方文档：https://vitest.dev/
- happy-dom：https://github.com/capricorn86/happy-dom
