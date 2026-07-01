/**
 * JS Obfuscation Script (Chrome Web Store Compatible)
 *
 * Usage: node scripts/obfuscate.js --seed <build_seed>
 *
 * Applies JavaScript obfuscation with randomized parameters based on build seed.
 * Each build produces different obfuscated output (version rotation).
 *
 * Chrome Web Store compatible:
 * - NO selfDefending (injects detection code)
 * - NO debugProtection (injects debugger statements)
 * - NO domainLock
 * - NO eval() based obfuscation
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const seedArg = args.find(a => a.startsWith('--seed='));
const seed = seedArg ? seedArg.split('=')[1] : 'default-seed';

// Deterministic RNG based on seed
function seedRng(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
}

const rng = seedRng(seed);

// Generate randomized obfuscation parameters
const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6 + rng() * 0.3, // 0.6~0.9
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2 + rng() * 0.3, // 0.2~0.5
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.6 + rng() * 0.3, // 0.6~0.9
  transformObjectKeys: true,
  splitStrings: true,
  splitStringsChunkLength: 6 + Math.floor(rng() * 8), // 6~13

  // Chrome Web Store compatible - these MUST be false
  selfDefending: false,
  debugProtection: false,
  domainLock: [],
  disableConsoleOutput: false,

  // Don't use eval
  target: 'browser',

  // Additional options for better obfuscation
  renameGlobals: false, // May break module imports
  identifierNamesGenerator: 'hexadecimal',
  renameProperties: false, // May break API calls
};

// Find all JS files in the build output
function findJsFiles(dir) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...findJsFiles(fullPath));
      } else if (extname(entry) === '.js') {
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err.message);
  }
  return files;
}

// Obfuscate a single file
function obfuscateFile(filePath) {
  try {
    const code = readFileSync(filePath, 'utf-8');

    // Skip if already obfuscated or too small
    if (code.length < 100) {
      console.log(`Skipping (too small): ${filePath}`);
      return;
    }

    // Use javascript-obfuscator if available, otherwise skip
    try {
      const JavaScriptObfuscator = require('javascript-obfuscator');
      const result = JavaScriptObfuscator.obfuscate(code, options);
      writeFileSync(filePath, result.getObfuscatedCode());
      console.log(`Obfuscated: ${filePath}`);
    } catch (requireErr) {
      console.log(`javascript-obfuscator not installed, skipping: ${filePath}`);
    }
  } catch (err) {
    console.error(`Error obfuscating ${filePath}:`, err.message);
  }
}

// Main
const outputDir = join(process.cwd(), '.output', 'chrome-mv3');

console.log(`Build seed: ${seed}`);
console.log(`Output dir: ${outputDir}`);
console.log(`Obfuscation params:`, {
  controlFlowFlatteningThreshold: options.controlFlowFlatteningThreshold.toFixed(2),
  deadCodeInjectionThreshold: options.deadCodeInjectionThreshold.toFixed(2),
  stringArrayThreshold: options.stringArrayThreshold.toFixed(2),
  splitStringsChunkLength: options.splitStringsChunkLength,
});

const jsFiles = findJsFiles(outputDir);
console.log(`Found ${jsFiles.length} JS files`);

for (const file of jsFiles) {
  obfuscateFile(file);
}

console.log('Obfuscation complete');
