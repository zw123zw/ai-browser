#!/bin/bash
# build-debug.sh - Debug build with logging enabled
#
# Usage: npm run build
# Output: .output/lingbot-debug-v{version}-{timestamp}.zip

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

BUILD_TIME=$(date +%Y%m%d-%H%M%S)
VERSION=$(node -p "require('./package.json').version")

echo "=========================================="
echo "  AI Browser - Debug Build (with logging)"
echo "=========================================="
echo "  Version: ${VERSION}"
echo "  Time: ${BUILD_TIME}"

# Clean
rm -rf .output

# Guide files and assets are synced by /site-gen skill, not here

# Build with logging enabled
echo ""
echo "[1/2] Building extension (VITE_LOG_ENABLED=true)..."
cross-env VITE_LOG_ENABLED=true wxt build

BUILD_DIR=".output/lingbot-debug-v${VERSION}-${BUILD_TIME}"
# Use node to rename (avoids permission issues on Windows)
node -e "const fs=require('fs'); fs.renameSync('.output/chrome-mv3', '${BUILD_DIR}')"

echo "  Build complete → $BUILD_DIR"

# Package zip
echo ""
echo "[2/2] Packaging zip..."
ZIP_NAME="lingbot-debug-v${VERSION}-${BUILD_TIME}.zip"

node -e "
  const fs = require('fs');
  const path = require('path');
  const JSZip = require('jszip');
  const zip = new JSZip();
  const buildDir = '${BUILD_DIR}';
  const zipPath = '.output/${ZIP_NAME}';
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
  addDir(buildDir, '');
  zip.generateAsync({ type: 'nodebuffer' }).then(buf => {
    fs.writeFileSync(zipPath, buf);
    console.log('  Package: ' + zipPath + ' (' + (buf.length/1024/1024).toFixed(1) + 'MB)');
    // Clean build directory
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log('  Cleaned: ' + buildDir);
  });
"

echo ""
echo "=========================================="
echo "  Debug Build Complete!"
echo "=========================================="
echo "  Version: ${VERSION}"
echo "  Package: .output/${ZIP_NAME}"
echo "  Note: VITE_LOG_ENABLED=true, logs visible in extension"
