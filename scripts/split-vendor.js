/**
 * Split content.js into vendor.js + content.js
 *
 * Post-build step: takes the bundled content.js and re-bundles it
 * using esbuild with code splitting to extract vendor dependencies.
 *
 * vendor.js = node_modules (no obfuscation needed)
 * content.js = project code (will be obfuscated)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const dirArg = args.find(a => a.startsWith('--dir='));
const outputDir = dirArg ? dirArg.split('=')[1] : join(process.cwd(), '.output', 'chrome-mv3');

const contentDir = join(outputDir, 'content-scripts');
const contentJs = join(contentDir, 'content.js');

console.log(`Splitting vendor from: ${basename(contentJs)}`);

const originalCode = readFileSync(contentJs, 'utf-8');
const originalSizeMB = (originalCode.length / (1024 * 1024)).toFixed(1);
console.log(`Original size: ${originalSizeMB}MB`);

// Create a temporary entry point that re-exports content.js
const tempEntry = join(contentDir, '__split_entry.js');
writeFileSync(tempEntry, `export * from './content.js';`);

try {
  const result = await build({
    entryPoints: [tempEntry],
    bundle: true,
    write: false,
    splitting: true,
    format: 'esm',
    target: 'es2020',
    outdir: contentDir,
    minify: false,
    metafile: true,
  });

  // Write the output files
  if (result.outputFiles) {
    for (const file of result.outputFiles) {
      const fileName = basename(file.path);
      // Skip the entry point output
      if (fileName === '__split_entry.js') continue;
      writeFileSync(file.path, file.text);
      const sizeMB = (file.text.length / (1024 * 1024)).toFixed(1);
      console.log(`  ${fileName}: ${sizeMB}MB`);
    }
  }

  console.log('Split complete');
} catch (err) {
  console.log(`Split not applicable (${err.message}), using original content.js`);
} finally {
  // Clean up temp file
  try {
    const fs = await import('fs');
    fs.unlinkSync(tempEntry);
  } catch {}
}
