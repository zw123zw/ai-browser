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

# Step 1: Generate build seed
echo ""
echo "[1/6] Generating build seed..."
BUILD_SEED=$(openssl rand -hex 32)
echo "$BUILD_SEED" > .build-seed
echo "  Build seed: ${BUILD_SEED:0:16}..."

# Step 2: Increment patch version
echo ""
echo "[2/6] Incrementing version..."
CURRENT_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

# Update package.json
node -e "
  const pkg = require('./package.json');
  pkg.version = '${NEW_VERSION}';
  require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "  Version: ${CURRENT_VERSION} → ${NEW_VERSION}"

# Step 3: Build wasm
echo ""
echo "[3/6] Building wasm module..."
cd wasm-license

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
  echo "  wasm-pack not found, installing..."
  cargo install wasm-pack
fi

wasm-pack build --target web --release --out-dir ../public/wasm
cd "$PROJECT_DIR"
echo "  Wasm build complete"

# Step 4: Build extension
echo ""
echo "[4/6] Building extension..."
cp docs/site/guide-zh.md public/guide-zh.md
cp docs/site/guide-en.md public/guide-en.md
wxt build
echo "  Extension build complete"

# Step 5: Obfuscate JS
echo ""
echo "[5/6] Obfuscating JavaScript..."
if [ -d ".output/chrome-mv3" ]; then
  node scripts/obfuscate.js --seed="$BUILD_SEED"
else
  echo "  Warning: .output/chrome-mv3 not found, skipping obfuscation"
fi

# Step 6: Package zip
echo ""
echo "[6/6] Packaging zip..."
BUILD_SEED_SHORT="${BUILD_SEED:0:8}"
ZIP_NAME="lingbot-v${NEW_VERSION}-${BUILD_SEED_SHORT}.zip"

if [ -d ".output/chrome-mv3" ]; then
  cd .output/chrome-mv3
  zip -r "../${ZIP_NAME}" . -x '*.map'
  cd "$PROJECT_DIR"
  echo "  Package: .output/${ZIP_NAME}"
else
  echo "  Warning: .output/chrome-mv3 not found, skipping packaging"
fi

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo "  Version: ${NEW_VERSION}"
echo "  Build seed: ${BUILD_SEED_SHORT}"
echo "  Output: .output/${ZIP_NAME}"
echo ""
echo "Next steps:"
echo "  1. Test the extension in Chrome"
echo "  2. Upload to Chrome Web Store Developer Dashboard"
echo "  3. Generate activation codes: node scripts/gen-license.js --version ${NEW_VERSION} --count 100 --days 30"
