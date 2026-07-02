#!/bin/bash
# build-store.sh - Complete build script for Chrome Web Store
#
# Usage: npm run build:store
#        bash scripts/build-store.sh
#
# Steps:
# 1. Generate build_seed
# 2. Increment patch version
# 3. Build wasm (Rust → wasm)
# 4. Build extension (wxt)
# 5. Obfuscate JS
# 6. Package zip

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=========================================="
echo "  AI Browser - Chrome Web Store Build"
echo "=========================================="

# Timestamp for this build
BUILD_TIME=$(date +%Y%m%d-%H%M%S)

# Step 0: Generate keys if not exists
if [ ! -f "scripts/keys/ed25519-private.key" ]; then
  echo "[0/7] Generating Ed25519 keys (first run)..."
  node scripts/gen-license.js --generate-keys
  echo ""
fi

# Step 1: Generate build seed
echo ""
echo "[1/7] Generating build seed..."
BUILD_SEED=$(openssl rand -hex 32)
echo "$BUILD_SEED" > .build-seed
echo "  Build seed: ${BUILD_SEED:0:16}..."

# Step 2: Read version from package.json
echo ""
echo "[2/7] Reading version..."
NEW_VERSION=$(node -p "require('./package.json').version")
echo "  Version: ${NEW_VERSION}"

# Step 3: Build wasm
echo ""
echo "[3/7] Building wasm module..."
cd wasm-license

# Add cargo to PATH
export PATH="$HOME/.cargo/bin:$PATH"

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
  echo "  wasm-pack not found, installing..."
  cargo install wasm-pack
fi

wasm-pack build --target web --release --out-dir ../public/wasm --no-opt
cd "$PROJECT_DIR"
echo "  Wasm build complete"

# Step 4: Build extension
echo ""
echo "[4/7] Building extension..."
cp docs/site/guide-zh.md public/guide-zh.md
cp docs/site/guide-en.md public/guide-en.md
BUILD_SEED_SHORT="${BUILD_SEED:0:8}"
BUILD_DIR=".output/lingbot-v${NEW_VERSION}-${BUILD_TIME}-${BUILD_SEED_SHORT}"
npx wxt build
# Use node to rename (avoids permission issues on Windows)
node -e "const fs=require('fs'); fs.renameSync('.output/chrome-mv3', '${BUILD_DIR}')"
echo "  Extension build complete → $BUILD_DIR"

# Step 5: Obfuscate JS (string encryption only, fast on large files)
echo ""
echo "[5/7] Obfuscating JavaScript..."
if [ -d "$BUILD_DIR" ]; then
  node scripts/obfuscate.js --seed="$BUILD_SEED" --dir="$BUILD_DIR"
else
  echo "  Warning: $BUILD_DIR not found, skipping"
fi

# Step 6: Package zip
echo ""
echo "[6/7] Packaging zip..."
ZIP_NAME="lingbot-v${NEW_VERSION}-${BUILD_SEED_SHORT}.zip"

if [ -d "$BUILD_DIR" ]; then
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
      // 删除构建目录，只保留 zip
      fs.rmSync(buildDir, { recursive: true, force: true });
      console.log('  Cleaned: ' + buildDir);
    });
  "
else
  echo "  Warning: $BUILD_DIR not found, skipping packaging"
fi

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo "  Version: ${NEW_VERSION}"
echo "  Build seed: ${BUILD_SEED_SHORT}"
echo "  Directory: ${BUILD_DIR}"
echo "  Package: .output/${ZIP_NAME}"
echo ""
echo "Next steps:"
echo "  1. Test the extension in Chrome"
echo "  2. Upload to Chrome Web Store Developer Dashboard"
echo "  3. Generate activation codes: node scripts/gen-license.js --version ${NEW_VERSION} --count 100 --days 30"
