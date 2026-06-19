#!/usr/bin/env bash
# ============================================================
# 构建前规则检测
# 规则 1: 禁止 console.*（前端代码不能打印到浏览器控制台）
# 规则 2: log-storage 写入函数只能通过 Logger 间接调用
#         （确保 VITE_LOG_ENABLED 门控生效，日志仅存在于测试包）
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=true

# ── 规则 1: 检测 console.* ──────────────────────────────────
echo ""
echo "━━━ 规则 1: 禁止 console.* ━━━"

# 排除: logger.ts / log-storage.ts / node_modules / .output / *.d.ts / test files
CONSOLE_HITS=$(grep -rnE '\bconsole\.(log|warn|error|debug|info|trace|dir|table)\b' \
  --include='*.ts' --include='*.vue' \
  --exclude-dir=node_modules --exclude-dir=.output --exclude-dir=.wxt \
  --exclude='*.d.ts' --exclude='*.test.ts' --exclude='*.spec.ts' \
  --exclude='logger.ts' --exclude='log-storage.ts' \
  entrypoints/ src/ 2>/dev/null || true)

if [ -n "$CONSOLE_HITS" ]; then
  echo -e "${RED}✗ 发现 console.* 调用（前端代码禁止直接打印到控制台）:${NC}"
  echo ""
  echo "$CONSOLE_HITS" | while IFS= read -r line; do
    echo -e "  ${RED}→${NC} $line"
  done
  echo ""
  echo -e "  ${YELLOW}修复方式: 改用 Logger${NC}"
  echo "    import { Logger } from '@/src/utils/logger';"
  echo "    const log = new Logger('ModuleName');"
  echo "    log.info('message', { detail });"
  echo ""
  PASS=false
else
  echo -e "${GREEN}✓ 未发现 console.* 调用${NC}"
fi

# ── 规则 2: 检测 log-storage 写入函数绕过 Logger 直接调用 ───
echo ""
echo "━━━ 规则 2: 日志存储仅通过 Logger 访问 ━━━"

# 检测 saveFrontendLog / saveApiLog 被直接 import 的情况
# 允许: logger.ts 内部的动态 import、log-storage.ts 自身的 export
# 允许: SettingsModal.vue 导入 downloadLogs（只读，且 UI 已有 v-if 门控）
# 禁止: 任何其他文件直接导入 saveFrontendLog / saveApiLog
LOG_STORAGE_HITS=$(grep -rnE '\b(saveFrontendLog|saveApiLog)\b' \
  --include='*.ts' --include='*.vue' \
  --exclude-dir=node_modules --exclude-dir=.output --exclude-dir=.wxt \
  --exclude='*.d.ts' --exclude='*.test.ts' --exclude='*.spec.ts' \
  --exclude='log-storage.ts' --exclude='logger.ts' \
  entrypoints/ src/ 2>/dev/null || true)

if [ -n "$LOG_STORAGE_HITS" ]; then
  echo -e "${RED}✗ 发现 log-storage 写入函数被直接调用:${NC}"
  echo ""
  echo "$LOG_STORAGE_HITS" | while IFS= read -r line; do
    echo -e "  ${RED}→${NC} $line"
  done
  echo ""
  echo -e "  ${YELLOW}风险: 直接调用 saveFrontendLog/saveApiLog 绕过了 Logger 的${NC}"
  echo -e "  ${YELLOW}VITE_LOG_ENABLED 门控，生产包可能意外写入日志到 storage${NC}"
  echo ""
  echo -e "  ${YELLOW}修复方式: 通过 Logger 间接调用${NC}"
  echo "    import { Logger } from '@/src/utils/logger';"
  echo "    const log = new Logger('ModuleName');"
  echo "    log.info('message');"
  echo ""
  PASS=false
else
  echo -e "${GREEN}✓ log-storage 写入函数未被直接调用${NC}"
fi

# ── 结果 ─────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$PASS" = true ]; then
  echo -e "${GREEN}✓ 所有规则通过，开始打包...${NC}"
  echo ""
  exit 0
else
  echo -e "${RED}✗ 规则检测失败，打包已中止${NC}"
  echo -e "  ${YELLOW}请修复上述问题后重新打包${NC}"
  echo ""
  exit 1
fi
