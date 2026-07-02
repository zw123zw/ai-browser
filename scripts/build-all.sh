#!/bin/bash
# build-all.sh - Build both test and production packages
#
# Usage: npm run build
# Output:
#   .output/release-v{version}-{timestamp}-{seed}/
#   ├── lingbot-v{version}-{seed}.zip          ← 生产包（无日志）
#   ├── lingbot-debug-v{version}-{timestamp}.zip ← 测试包（有日志）
#   ├── licenses-v{version}.csv                ← 激活码
#   └── .build-seed                            ← BUILD_SEED

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

BUILD_TIME=$(date +%Y%m%d-%H%M%S)
VERSION=$(node -p "require('./package.json').version")

echo "=========================================="
echo "  AI Browser - Full Build"
echo "=========================================="
echo "  Version: ${VERSION}"
echo "  Time: ${BUILD_TIME}"

# Step 1: Generate build seed
echo ""
echo "[1/6] Generating build seed..."
BUILD_SEED=$(openssl rand -hex 32)
echo "$BUILD_SEED" > .build-seed
BUILD_SEED_SHORT="${BUILD_SEED:0:8}"
echo "  Build seed: ${BUILD_SEED_SHORT}..."

# Step 2: Create release directory
RELEASE_DIR=".output/release-v${VERSION}-${BUILD_TIME}-${BUILD_SEED_SHORT}"
mkdir -p "$RELEASE_DIR"
echo "$BUILD_SEED" > "$RELEASE_DIR/.build-seed"

# Step 3: Build wasm
echo ""
echo "[2/6] Building wasm module..."
cd wasm-license
export PATH="$HOME/.cargo/bin:$PATH"
wasm-pack build --target web --release --no-opt 2>&1 | tail -3
cd "$PROJECT_DIR"
echo "  Wasm build complete"

# Step 4: Build production version (no logging)
echo ""
echo "[3/6] Building production version..."
rm -rf .output/chrome-mv3
npx wxt build 2>&1 | tail -5
PROD_DIR=".output/prod-v${VERSION}-${BUILD_TIME}"
node -e "const fs=require('fs'); fs.renameSync('.output/chrome-mv3', '${PROD_DIR}')"
echo "  Production build complete"

# Step 5: Build test version (with logging)
echo ""
echo "[4/6] Building test version..."
rm -rf .output/chrome-mv3
cross-env VITE_LOG_ENABLED=true wxt build 2>&1 | tail -5
TEST_DIR=".output/test-v${VERSION}-${BUILD_TIME}"
node -e "const fs=require('fs'); fs.renameSync('.output/chrome-mv3', '${TEST_DIR}')"
echo "  Test build complete"

# Step 6: Package both zips
echo ""
echo "[5/6] Packaging zips..."
PROD_ZIP="lingbot-v${VERSION}-${BUILD_SEED_SHORT}.zip"
TEST_ZIP="lingbot-debug-v${VERSION}-${BUILD_TIME}.zip"

node -e "
  const fs = require('fs');
  const path = require('path');
  const JSZip = require('jszip');

  async function packDir(srcDir, zipPath) {
    const zip = new JSZip();
    function addDir(dir, prefix) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const zipName = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory()) {
          addDir(fullPath, zipName);
        } else {
          zip.file(zipName, fs.readFileSync(fullPath));
        }
      }
    }
    addDir(srcDir, '');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(zipPath, buf);
    return buf.length;
  }

  (async () => {
    const prodSize = await packDir('${PROD_DIR}', '${RELEASE_DIR}/${PROD_ZIP}');
    console.log('  Production: ${RELEASE_DIR}/${PROD_ZIP} (' + (prodSize/1024/1024).toFixed(1) + 'MB)');

    const testSize = await packDir('${TEST_DIR}', '${RELEASE_DIR}/${TEST_ZIP}');
    console.log('  Test: ${RELEASE_DIR}/${TEST_ZIP} (' + (testSize/1024/1024).toFixed(1) + 'MB)');

    // Clean build directories
    fs.rmSync('${PROD_DIR}', { recursive: true, force: true });
    fs.rmSync('${TEST_DIR}', { recursive: true, force: true });
    console.log('  Cleaned build directories');
  })();
"

# Step 7: Generate activation codes
echo ""
echo "[6/6] Generating activation codes..."
LICENSE_FILE="${RELEASE_DIR}/licenses-v${VERSION}.csv"
node scripts/gen-license.js --count=100 --days=30 --output="${LICENSE_FILE}"

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo "  Version: ${VERSION}"
echo "  Build seed: ${BUILD_SEED_SHORT}"
echo "  Release: ${RELEASE_DIR}/"
echo "    ├── ${PROD_ZIP}          ← 上传 Chrome Web Store"
echo "    ├── ${TEST_ZIP}           ← 本地测试（带日志）"
echo "    ├── licenses-v${VERSION}.csv  ← 上传 Gumroad/爱发电"
echo "    └── .build-seed"
