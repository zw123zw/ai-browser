/**
 * JS Post-processing Script
 *
 * Applies additional mangling/compression to built JS files.
 * Uses esbuild (fast, handles any file size).
 *
 * vendor.js and wasm/*.js are skipped.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { transform } from 'esbuild';

const args = process.argv.slice(2);
const dirArg = args.find(a => a.startsWith('--dir='));
const outputDir = dirArg ? dirArg.split('=')[1] : join(process.cwd(), '.output', 'chrome-mv3');

// Find JS files to process (skip vendor, wasm glue)
function findJsFiles(dir) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'wasm') continue;
        files.push(...findJsFiles(fullPath));
      } else if (extname(entry) === '.js') {
        if (basename(entry) === 'vendor.js') continue;
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
  return files;
}

console.log(`Processing: ${outputDir}`);
const jsFiles = findJsFiles(outputDir);
console.log(`Found ${jsFiles.length} JS files\n`);

for (const filePath of jsFiles) {
  const code = readFileSync(filePath, 'utf-8');
  const sizeMB = (code.length / (1024 * 1024)).toFixed(1);
  console.log(`  ${basename(filePath)} (${sizeMB}MB) ...`);

  const result = await transform(code, {
    minify: true,
    target: 'es2020',
    format: 'iife',
    legalComments: 'none',
  });

  writeFileSync(filePath, result.code);
  const newSizeMB = (result.code.length / (1024 * 1024)).toFixed(1);
  console.log(`  ✓ ${newSizeMB}MB`);
}

console.log('\nDone');
