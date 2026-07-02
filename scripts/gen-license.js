/**
 * Activation Code Generator (Private Script - NOT distributed with extension)
 *
 * Usage:
 *   node scripts/gen-license.js --generate-keys
 *   node scripts/gen-license.js --version 1.8.4 --count 100 --days 30
 *   node scripts/gen-license.js --version 1.8.4 --days 30 --fingerprint abc123
 *   node scripts/gen-license.js --reset --old-fingerprint abc123 --new-fingerprint def456
 *
 * Code format: AIB-XXXX-XXXX-XXXX
 * - Part 1: version(1B) + expire_month(1B) + random(2B)
 * - Part 2: expire_ts low 4 bytes (base32)
 * - Part 3: fingerprint_hash low 4 bytes + HMAC signature (base32)
 */

import { createHash, createHmac, randomBytes } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Constants ──

const KEYS_DIR = join(import.meta.dirname, 'keys');
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'ed25519-private.key');
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'ed25519-public.key');
const BUILD_SEED_PATH = join(import.meta.dirname, '..', '.build-seed');

// ── Parse Arguments ──

const args = process.argv.slice(2);

function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

// ── Key Management ──

function generateKeys() {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
  }

  // Generate HMAC keys (simplified - Ed25519 will be added later)
  const masterSecret = randomBytes(32).toString('hex');
  const publicKey = randomBytes(32).toString('hex');

  writeFileSync(PRIVATE_KEY_PATH, masterSecret, 'utf-8');
  writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf-8');

  console.log('Keys generated:');
  console.log(`  Private: ${PRIVATE_KEY_PATH}`);
  console.log(`  Public:  ${PUBLIC_KEY_PATH}`);
  console.log('');
  console.log('⚠️  Keep private key secure! Never commit to git.');
  console.log('⚠️  Copy public key to wasm-license/src/ for compilation.');
}

function loadPrivateKey() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error('Private key not found. Run with --generate-keys first.');
    process.exit(1);
  }
  return readFileSync(PRIVATE_KEY_PATH, 'utf-8').trim();
}

function loadBuildSeed() {
  if (existsSync(BUILD_SEED_PATH)) {
    return readFileSync(BUILD_SEED_PATH, 'utf-8').trim();
  }
  return 'dev-default-seed';
}

// ── Code Generation ──

function base32Encode(buffer) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

function generateCode(version, days, fingerprint, buildSeed, privateKey) {
  // Parse version
  const parts = version.split('.');
  const versionMajor = parseInt(parts[0]) || 1;
  const versionMinor = parseInt(parts[1]) || 0;

  // Calculate expire timestamp
  const now = Date.now();
  const expireTs = now + days * 24 * 60 * 60 * 1000;

  // Calculate expire month (months since 2024-01-01)
  const baseTs = new Date('2024-01-01').getTime();
  const expireMonth = Math.floor((expireTs - baseTs) / (30 * 24 * 60 * 60 * 1000));

  // Get expire_ts low 4 bytes (relative to month start)
  const monthStartTs = baseTs + expireMonth * 30 * 24 * 60 * 60 * 1000;
  const expireTsLow = expireTs - monthStartTs;

  // Encode expire_ts low as 4 bytes
  const expireBytes = Buffer.alloc(4);
  expireBytes.writeUInt32BE(Math.min(expireTsLow, 0xFFFFFFFF), 0);

  // Calculate fingerprint hash
  const fpHash = createHash('sha256').update(fingerprint || 'default').digest();
  const fpHashShort = fpHash.slice(0, 4);

  // Generate HMAC signature
  const versionStr = `${versionMajor}.${versionMinor}`;
  const hmacKey = createHash('sha256')
    .update(`verify-${versionStr}-${buildSeed}-${privateKey}`)
    .digest();
  const dataToSign = `${versionStr}|${expireTs}|${fpHashShort.toString('hex')}|${fingerprint || 'default'}`;
  const signature = createHmac('sha256', hmacKey).update(dataToSign).digest();
  const sigShort = signature.slice(0, 4);

  // Build code parts
  const part1Buffer = Buffer.from([versionMajor, versionMinor, expireMonth & 0xFF, randomBytes(1)[0]]);
  const part2Buffer = expireBytes;
  const part3Buffer = Buffer.concat([fpHashShort, sigShort]);

  // Encode as base32
  const part1 = base32Encode(part1Buffer);
  const part2 = base32Encode(part2Buffer);
  const part3 = base32Encode(part3Buffer);

  return `AIB-${part1}-${part2}-${part3}`;
}

// ── Main ──

if (hasFlag('generate-keys')) {
  generateKeys();
  process.exit(0);
}

if (hasFlag('reset')) {
  console.log('Device reset code generation not yet implemented.');
  process.exit(0);
}

const version = getArg('version');
const count = parseInt(getArg('count') || '1');
const days = parseInt(getArg('days') || '30');
const fingerprint = getArg('fingerprint');
const output = getArg('output');

if (!version) {
  console.error('Missing --version argument');
  console.error('Usage: node gen-license.js --version=1.8.4 --count=100 --days=30');
  process.exit(1);
}

const buildSeed = loadBuildSeed();
const privateKey = loadPrivateKey();

console.log(`Generating ${count} activation codes...`);
console.log(`  Version: ${version}`);
console.log(`  Days: ${days}`);
console.log(`  Build seed: ${buildSeed.substring(0, 8)}...`);

const codes = [];
for (let i = 0; i < count; i++) {
  const code = generateCode(version, days, fingerprint, buildSeed, privateKey);
  codes.push(code);
}

// Default output: docs/发布/licenses-v{version}.csv
const outputFile = output || `docs/发布/licenses-v${version}.csv`;

const csv = ['code,version,expire', ...codes.map(c => {
  const expireDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return `${c},${version},${expireDate}`;
})].join('\n');
writeFileSync(outputFile, csv, 'utf-8');
console.log(`\n${count} codes written to ${outputFile}`);
