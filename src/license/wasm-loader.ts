/**
 * License Loader - Wasm + Worker API
 *
 * Architecture:
 * - Worker API: source of truth (trial, activation, validation)
 * - Wasm: local encryption/decryption + offline fallback
 * - chrome.storage: local cache
 *
 * Flow:
 * 1. Check Worker API (online) → update local cache
 * 2. If offline → use local cache (wasm validation)
 * 3. Local cache always encrypted with wasm
 */

import { Logger } from '@/src/utils/logger';
import { generateFingerprint } from './fingerprint';
import { registerTrial, activateCode as apiActivate, checkLicense as apiCheck } from './api';

const log = new Logger('License:WasmLoader');

/** Storage keys */
const BLOB_KEY = 'aib-enc-blob';
const STATUS_KEY = 'aib-license-status';

/** Wasm module instance */
let wasmModule: any = null;

/** Current fingerprint */
let currentFingerprint: string | null = null;

/** Cached status */
let cachedStatus: {
  status: string;
  daysLeft: number;
  expired: boolean;
  expireTs: number;
  trialEndTs: number;
} | null = null;

/**
 * Initialize the wasm module
 */
export async function initWasm(): Promise<void> {
  try {
    const glueUrl = chrome.runtime.getURL('wasm/wasm_license.js');
    const wasm = await import(glueUrl);

    const wasmUrl = chrome.runtime.getURL('wasm/wasm_license_bg.wasm');
    const resp = await fetch(wasmUrl);
    if (!resp.ok) throw new Error(`Failed to fetch wasm: ${resp.status}`);

    const bytes = await resp.arrayBuffer();
    await wasm.default(bytes);
    wasmModule = wasm;

    // Generate fingerprint
    currentFingerprint = await generateFingerprint(wasm);

    log.info('Wasm initialized', { fingerprint: currentFingerprint?.substring(0, 16) + '...' });
  } catch (err) {
    log.error('Failed to init wasm', err);
    throw err;
  }
}

/**
 * Get current fingerprint
 */
async function getFingerprint(): Promise<string> {
  if (!currentFingerprint) {
    const wasm = getWasm();
    currentFingerprint = await generateFingerprint(wasm);
  }
  return currentFingerprint;
}

/**
 * Get wasm module
 */
function getWasm(): any {
  if (!wasmModule) throw new Error('Wasm not initialized');
  return wasmModule;
}

/**
 * Read cached status from storage
 */
async function readCachedStatus(): Promise<typeof cachedStatus> {
  if (cachedStatus) return cachedStatus;
  try {
    const result = await chrome.storage.local.get(STATUS_KEY);
    cachedStatus = result[STATUS_KEY] || null;
    return cachedStatus;
  } catch {
    return null;
  }
}

/**
 * Write status to cache
 */
async function writeCachedStatus(status: typeof cachedStatus): Promise<void> {
  try {
    await chrome.storage.local.set({ [STATUS_KEY]: status });
    cachedStatus = status;
  } catch (err) {
    log.error('Failed to write status cache', err);
  }
}

/**
 * Initialize trial period
 * Tries Worker API first, falls back to local
 */
export async function initTrial(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
}> {
  const fingerprint = await getFingerprint();
  const version = chrome.runtime.getManifest().version;

  // Try Worker API
  try {
    const result = await registerTrial(fingerprint, version);
    if (result.success) {
      const now = Date.now();
      const daysLeft = Math.ceil((result.trial_end_ts - now) / (24 * 60 * 60 * 1000));

      const status = {
        status: 'trial' as const,
        daysLeft,
        expired: false,
        expireTs: 0,
        trialEndTs: result.trial_end_ts,
      };

      await writeCachedStatus(status);
      log.info('Trial registered via Worker', { daysLeft, trial_end_ts: result.trial_end_ts });
      return status;
    }
  } catch (err) {
    log.warn('Worker trial registration failed, using local', err);
  }

  // Fallback: local trial (7 days)
  const now = Date.now();
  const trialEndTs = now + 7 * 24 * 60 * 60 * 1000;
  const status = {
    status: 'trial' as const,
    daysLeft: 7,
    expired: false,
    expireTs: 0,
    trialEndTs,
  };

  await writeCachedStatus(status);
  log.info('Trial initialized locally', { daysLeft: 7 });
  return status;
}

/**
 * Activate with code
 * Tries Worker API first
 */
export async function activateCode(code: string): Promise<{
  valid: boolean;
  error: string | null;
  status?: string;
  daysLeft?: number;
}> {
  // Check if already active
  const current = await checkLicense();
  if (current.status === 'active' && !current.expired) {
    log.info('Already active, skipping re-activation');
    return { valid: true, error: null, ...current };
  }

  const fingerprint = await getFingerprint();

  // Try Worker API
  try {
    const result = await apiActivate(code, fingerprint);
    if (result.success) {
      const now = Date.now();
      const daysLeft = Math.ceil((result.expire_ts - now) / (24 * 60 * 60 * 1000));

      const status = {
        status: 'active' as const,
        daysLeft,
        expired: false,
        expireTs: result.expire_ts,
        trialEndTs: 0,
      };

      await writeCachedStatus(status);
      log.info('Activated via Worker', { daysLeft, expire_ts: result.expire_ts });
      return { valid: true, error: null, ...status };
    } else {
      log.warn('Activation failed', { error: result.error });
      return { valid: false, error: result.error || 'Activation failed' };
    }
  } catch (err) {
    log.error('Worker activation failed', err);
    return { valid: false, error: 'Server unreachable' };
  }
}

/**
 * Check license status
 * Tries Worker API first, falls back to local cache
 */
export async function checkLicense(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
}> {
  const fingerprint = await getFingerprint();

  // Try Worker API
  try {
    const result = await apiCheck(fingerprint);
    const now = Date.now();

    if (result.status === 'active') {
      const status = {
        status: 'active',
        daysLeft: result.days_left,
        expired: false,
        expireTs: result.expire_ts,
        trialEndTs: 0,
      };
      await writeCachedStatus(status);
      return status;
    }

    if (result.status === 'trial') {
      const status = {
        status: 'trial',
        daysLeft: result.days_left,
        expired: false,
        expireTs: 0,
        trialEndTs: result.trial_end_ts,
      };
      await writeCachedStatus(status);
      return status;
    }

    if (result.status === 'expired') {
      const status = {
        status: 'expired',
        daysLeft: 0,
        expired: true,
        expireTs: 0,
        trialEndTs: result.trial_end_ts,
      };
      await writeCachedStatus(status);
      return status;
    }

    // not_found → need to register trial
    if (result.status === 'not_found') {
      log.info('No license found, registering trial');
      return await initTrial();
    }
  } catch (err) {
    log.warn('Worker check failed, using local cache', err);
  }

  // Fallback: use local cache
  const cached = await readCachedStatus();
  if (cached) {
    const now = Date.now();

    // Check if expired
    if (cached.status === 'active' && cached.expireTs > 0 && now > cached.expireTs) {
      return { status: 'expired', daysLeft: 0, expired: true };
    }
    if (cached.status === 'trial' && cached.trialEndTs > 0 && now > cached.trialEndTs) {
      return { status: 'expired', daysLeft: 0, expired: true };
    }

    // Recalculate days left
    let daysLeft = cached.daysLeft;
    if (cached.status === 'active' && cached.expireTs > 0) {
      daysLeft = Math.ceil((cached.expireTs - now) / (24 * 60 * 60 * 1000));
    }
    if (cached.status === 'trial' && cached.trialEndTs > 0) {
      daysLeft = Math.ceil((cached.trialEndTs - now) / (24 * 60 * 60 * 1000));
    }

    return { status: cached.status, daysLeft: Math.max(0, daysLeft), expired: cached.expired };
  }

  // No cache → first install
  return await initTrial();
}

/**
 * Track usage (local only, for statistics)
 */
export async function trackUsage(_action: string): Promise<void> {
  // Usage tracking is local-only for now
  // Can be extended to send to Worker later
}

/**
 * Clear all license data
 */
export async function clearLicense(): Promise<void> {
  await chrome.storage.local.remove([BLOB_KEY, STATUS_KEY]);
  cachedStatus = null;
  log.info('License data cleared');
}
