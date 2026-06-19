# Build Check — 构建前规则检测

在打包（`npm run build` / `build:prod` / `build:debug`）前自动执行，也可手动运行。

## 规则

| # | 检查项 | 目的 |
|---|--------|------|
| 1 | `entrypoints/` 和 `src/` 中禁止 `console.*` 调用 | 前端代码不能打印到浏览器控制台 |
| 2 | `saveFrontendLog` / `saveApiLog` 不能被 Logger 之外的文件直接导入 | 确保日志写入受 `VITE_LOG_ENABLED` 门控，仅测试包有日志 |

## 使用方式

### 自动（已集成到 npm scripts）

```bash
npm run build       # 检测 → prod 构建 → test 构建
npm run build:prod  # 检测 → prod 构建
npm run build:debug # 检测 → debug 构建
```

检测失败会阻断打包，输出违规位置和修复建议。

### 手动运行

```bash
bash scripts/build-check.sh
```

### 在 Claude Code 中调用

当用户要求"检查打包规则"或"跑一下 build check"时，执行：

```bash
bash scripts/build-check.sh
```

## 修复指南

### 违反规则 1（console.*）

```typescript
// ✗ 错误
console.log('something');
console.warn('warning');

// ✓ 正确
import { Logger } from '@/src/utils/logger';
const log = new Logger('ModuleName');
log.info('something');
log.warn('warning');
```

### 违反规则 2（直接导入 log-storage 写入函数）

```typescript
// ✗ 错误 — 绕过 Logger 的 VITE_LOG_ENABLED 门控
import { saveFrontendLog } from '@/src/utils/log-storage';
saveFrontendLog('INFO', 'Module', 'msg');

// ✓ 正确 — 通过 Logger 间接调用
import { Logger } from '@/src/utils/logger';
const log = new Logger('Module');
log.info('msg');
```

`downloadLogs` 的直接导入是安全的（只读操作，且 UI 已有 `v-if="logEnabled"` 门控）。

## 技术细节

- 脚本位置：`scripts/build-check.sh`
- 排除范围：`node_modules`、`.output`、`.wxt`、`*.d.ts`、`*.test.ts`、`*.spec.ts`、`logger.ts`、`log-storage.ts`
- 退出码：0 = 通过，1 = 有违规
