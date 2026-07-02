/**
 * Wasm License Loader - JS Thin Shell Layer
 *
 * This module ONLY:
 * 1. Loads the wasm module
 * 2. Reads encrypted blob from chrome.storage → passes to wasm
 * 3. Calls wasm functions → reads returned results
 * 4. Calls tick() on user operations → wasm internal statistics
 * 5. Exposes wasm state to Vue components
 *
 * NO if/else logic, NO validation logic.
 * ALL decisions happen inside wasm.
 */

import { Logger } from '@/src/utils/logger';
import { generateFingerprint } from './fingerprint';

const log = new Logger('License:WasmLoader');

/** Storage key for encrypted license blob */
const BLOB_KEY = 'aib-enc-blob';

/** Storage key for encrypted usage data */
const USAGE_KEY = 'aib-enc-usage';

/** Wasm module instance (lazy loaded) */
let wasmModule: any = null;

/** Current cached blob */
let cachedBlob: string | null = null;

/** License status cache */
let licenseStatus: {
  status: string;
  daysLeft: number;
  expired: boolean;
} | null = null;

/**
 * Initialize the wasm module
 * Must be called before any other function
 */
export async function initWasm(): Promise<void> {
  try {
    // Load wasm glue JS via fetch + eval (Chrome extension compatible)
    const glueUrl = chrome.runtime.getURL('wasm/wasm_license.js');
    const glueResp = await fetch(glueUrl);
    const glueCode = await glueResp.text();

    // Create a module from the glue code
    const blob = new Blob([glueCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const wasm = await import(blobUrl);
    URL.revokeObjectURL(blobUrl);

    // Load wasm binary manually (avoid MIME type issue in Chrome extensions)
    const wasmUrl = chrome.runtime.getURL('wasm/wasm_license_bg.wasm');
    const resp = await fetch(wasmUrl);
    const bytes = await resp.arrayBuffer();

    // Initialize with manual bytes (bypasses instantiateStreaming MIME check)
    await wasm.default(bytes);
    wasmModule = wasm;
    log.info('Wasm module initialized');
  } catch (err) {
    log.error('Failed to initialize wasm module', err);
    throw err;
  }
}

/**
 * Get the wasm module instance
 * Throws if not initialized
 */
function getWasm(): any {
  if (!wasmModule) {
    throw new Error('Wasm module not initialized. Call initWasm() first.');
  }
  return wasmModule;
}

/**
 * Read encrypted blob from chrome.storage
 */
async function readBlob(): Promise<string | null> {
  if (cachedBlob) return cachedBlob;
  try {
    const result = await chrome.storage.local.get(BLOB_KEY);
    cachedBlob = result[BLOB_KEY] || null;
    return cachedBlob;
  } catch (err) {
    log.error('Failed to read blob from storage', err);
    return null;
  }
}

/**
 * Write encrypted blob to chrome.storage
 */
async function writeBlob(blob: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [BLOB_KEY]: blob });
    cachedBlob = blob;
    log.debug('Blob written to storage');
  } catch (err) {
    log.error('Failed to write blob to storage', err);
  }
}

/**
 * Read encrypted usage from chrome.storage
 */
async function readUsage(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(USAGE_KEY);
    return result[USAGE_KEY] || null;
  } catch (err) {
    log.error('Failed to read usage from storage', err);
    return null;
  }
}

/**
 * Write encrypted usage to chrome.storage
 */
async function writeUsage(usage: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [USAGE_KEY]: usage });
    log.debug('Usage written to storage');
  } catch (err) {
    log.error('Failed to write usage to storage', err);
  }
}

/**
 * Initialize trial period (first install)
 * Calls wasm.init_trial(fingerprint, now)
 */
export async function initTrial(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
}> {
  const wasm = getWasm();
  const fingerprint = await generateFingerprint(wasm);
  const now = Date.now();

  const resultJson = wasm.init_trial(fingerprint, now);
  const result = JSON.parse(resultJson);

  await writeBlob(result.blob);

  licenseStatus = {
    status: result.status,
    daysLeft: result.daysLeft,
    expired: false,
  };

  log.info('Trial initialized', { daysLeft: result.daysLeft });
  return licenseStatus;
}

/**
 * Verify activation code
 * Calls wasm.verify_code(code, fingerprint, now)
 */
export async function activateCode(code: string): Promise<{
  valid: boolean;
  error: string | null;
  status?: string;
  daysLeft?: number;
}> {
  const wasm = getWasm();
  const fingerprint = await generateFingerprint(wasm);
  const now = Date.now();

  const resultJson = wasm.verify_code(code, fingerprint, now);
  const result = JSON.parse(resultJson);

  if (result.valid) {
    await writeBlob(result.blob);
    // Re-check to get current status
    const status = await checkLicense();
    return { valid: true, error: null, ...status };
  }

  log.warn('Activation failed', { error: result.error });
  return { valid: false, error: result.error };
}

/**
 * Check license status
 * Calls wasm.check_license(blob, now)
 * Returns { status, daysLeft, expired }
 */
export async function checkLicense(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
}> {
  const wasm = getWasm();
  const blob = await readBlob();

  if (!blob) {
    // No blob = first install
    return initTrial();
  }

  const now = Date.now();
  const resultJson = wasm.check_license(blob, now);
  const result = JSON.parse(resultJson);

  // Update blob if status changed (e.g., trial → expired)
  if (result.status === 'expired' && blob) {
    // Wasm may have updated the blob internally
    // For now, we keep the same blob
  }

  licenseStatus = {
    status: result.status,
    daysLeft: result.daysLeft,
    expired: result.expired,
  };

  return licenseStatus;
}

/**
 * Track usage and optionally trigger stealth check
 * Called on every user action (chat, voice, automation)
 * Calls wasm.track_usage(blob, action, ts) and wasm.hidden_verify(blob) if needed
 */
export async function tick(
  action: 'chat' | 'voice' | 'automation',
): Promise<void> {
  const wasm = getWasm();
  const blob = await readBlob();
  if (!blob) return;

  try {
    // Track usage
    const usageJson = wasm.track_usage(blob, action, Date.now());
    const usage = JSON.parse(usageJson);

    // Update usage storage
    // Note: In production, the wasm module handles encrypted usage internally

    // Check if stealth verification should trigger
    if (usage.shouldCheck) {
      log.debug('Stealth check triggered');
      const verifyJson = wasm.hidden_verify(blob);
      const verify = JSON.parse(verifyJson);

      if (!verify.passed) {
        log.warn('Stealth check failed', { degradeLevel: verify.degradeLevel });
        // Update degrade level in blob
        // Note: In production, wasm handles this internally
      }
    }
  } catch (err) {
    log.error('Tick failed', err);
  }
}

/**
 * Get current cached license status
 * Returns null if not initialized
 */
export function getCachedStatus(): typeof licenseStatus {
  return licenseStatus;
}

/**
 * Clear all license data (for testing/reset)
 */
export async function clearLicense(): Promise<void> {
  await chrome.storage.local.remove([BLOB_KEY, USAGE_KEY]);
  cachedBlob = null;
  licenseStatus = null;
  log.info('License data cleared');
}
