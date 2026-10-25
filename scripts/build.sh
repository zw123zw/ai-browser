#!/bin/bash
# build.sh - Unified build script
#
# Usage:
#   bash scripts/build.sh       # Build both
#   bash scripts/build.sh test  # Build test only
#   bash scripts/build.sh prod  # Build prod only
#
# Output: .output/release-v{version}-{timestamp}/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

BUILD_TIME=$(date +%Y%m%d-%H%M%S)
VERSION=$(node -p "require('./package.json').version")

# Parse arguments
BUILD_MODE="all"

for arg in "$@"; do
  case $arg in
    test|prod|all) BUILD_MODE="$arg" ;;
  esac
done

echo "=========================================="
echo "  AI Browser Build (${BUILD_MODE})"
echo "=========================================="
echo "  Version: ${VERSION}"
echo "  Time: ${BUILD_TIME}"

# Step 1: Create release directory
RELEASE_DIR=".output/release-v${VERSION}-${BUILD_TIME}"
mkdir -p "$RELEASE_DIR"

# Step 2: Build prod version
if [ "$BUILD_MODE" = "all" ] || [ "$BUILD_MODE" = "prod" ]; then
  echo ""
  echo "[2/4] Building production version..."
  rm -rf .output/chrome-mv3
  npx wxt build 2>&1 | tail -5
  PROD_DIR=".output/prod-v${VERSION}-${BUILD_TIME}"
  node -e "const fs=require('fs'); fs.renameSync('.output/chrome-mv3', '${PROD_DIR}')"
  echo "  Production build complete"
else
  echo ""
  echo "[2/4] Skipping production build"
fi

# Step 3: Build test version
if [ "$BUILD_MODE" = "all" ] || [ "$BUILD_MODE" = "test" ]; then
  echo ""
  echo "[3/4] Building test version..."
  rm -rf .output/chrome-mv3
  cross-env VITE_LOG_ENABLED=true wxt build 2>&1 | tail -5
  TEST_DIR=".output/test-v${VERSION}-${BUILD_TIME}"
  node -e "const fs=require('fs'); fs.renameSync('.output/chrome-mv3', '${TEST_DIR}')"
  echo "  Test build complete"
else
  echo ""
  echo "[3/4] Skipping test build"
fi

# Step 4: Package zips
echo ""
echo "[4/4] Packaging zips..."
PROD_ZIP="lingbot-v${VERSION}-${BUILD_TIME}.zip"
TEST_ZIP="lingbot-debug-v${VERSION}-${BUILD_TIME}.zip"

node -e "
  const fs = require('fs');
  const path = require('path');
  const JSZip = require('jszip');

  async function packDir(srcDir, zipPath) {
    if (!fs.existsSync(srcDir)) return 0;
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

  const releaseDir = '${RELEASE_DIR}';
  const prodDir = '${PROD_DIR:-}';
  const testDir = '${TEST_DIR:-}';
  const prodZip = '${PROD_ZIP}';
  const testZip = '${TEST_ZIP}';

  fs.mkdirSync(releaseDir, { recursive: true });

  (async () => {
    if (prodDir) {
      const prodSize = await packDir(prodDir, releaseDir + '/' + prodZip);
      if (prodSize) console.log('  Production: ' + prodZip + ' (' + (prodSize/1024/1024).toFixed(1) + 'MB)');
      fs.rmSync(prodDir, { recursive: true, force: true });
    }
    if (testDir) {
      const testSize = await packDir(testDir, releaseDir + '/' + testZip);
      if (testSize) console.log('  Test: ' + testZip + ' (' + (testSize/1024/1024).toFixed(1) + 'MB)');
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    console.log('  Cleaned build directories');
  })();
"

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo "  Version: ${VERSION}"
echo "  Release: ${RELEASE_DIR}/"
ls -1 "$RELEASE_DIR" | while read f; do echo "    ├── $f"; done
