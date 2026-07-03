/**
 * License Loader - Simple Worker API approach
 *
 * - Worker API is the only source of truth
 * - Memory cache only (1 hour), not in storage
 * - User can't modify license status
 */

import { Logger } from '@/src/utils/logger';
import { generateFingerprint } from './fingerprint';
import { registerTrial, activateCode as apiActivate, checkLicense as apiCheck } from './api';

const log = new Logger('License:WasmLoader');

/** Wasm module instance */
let wasmModule: any = null;

/** Current fingerprint */
let currentFingerprint: string | null = null;

/** Memory cache */
let cachedStatus: {
  status: string;
  daysLeft: number;
  expired: boolean;
  expireTs: number;
  trialEndTs: number;
} | null = null;

/** Last check timestamp */
let lastCheckTs = 0;

/** Cache valid for 1 hour */
const CACHE_TTL = 60 * 60 * 1000;

/** Storage key for offline cache */
const CACHE_KEY = 'aib-license-cache';

/** Read offline cache from storage */
async function readOfflineCache(): Promise<typeof cachedStatus> {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    return result[CACHE_KEY] || null;
  } catch {
    return null;
  }
}

/** Write cache to storage (for offline fallback) */
async function writeOfflineCache(status: typeof cachedStatus): Promise<void> {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: status });
  } catch (err) {
    log.error('Failed to write cache', err);
  }
}

/**
 * Initialize wasm module
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

    currentFingerprint = await generateFingerprint(wasm);
    log.info('Wasm initialized', { fingerprint: currentFingerprint?.substring(0, 16) + '...' });
  } catch (err) {
    log.error('Failed to init wasm', err);
    throw err;
  }
}

function getWasm(): any {
  if (!wasmModule) throw new Error('Wasm not initialized');
  return wasmModule;
}

async function getFingerprint(): Promise<string> {
  if (!currentFingerprint) {
    currentFingerprint = await generateFingerprint(getWasm());
  }
  return currentFingerprint;
}

/**
 * Check license
 * Priority: memory cache > Worker API > offline cache
 */
export async function checkLicense(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
}> {
  const now = Date.now();

  // 1. Memory cache (1 hour)
  if (cachedStatus && (now - lastCheckTs) < CACHE_TTL) {
    return { status: cachedStatus.status, daysLeft: cachedStatus.daysLeft, expired: cachedStatus.expired };
  }

  // 2. Try Worker API
  const fingerprint = await getFingerprint();
  log.info('Checking license via API', { fingerprint: fingerprint?.substring(0, 16) });

  try {
    const result = await apiCheck(fingerprint);
    log.info('API result:', JSON.stringify(result));
    lastCheckTs = now;

    if (result.status === 'active') {
      cachedStatus = { status: 'active', daysLeft: result.days_left, expired: false, expireTs: result.expire_ts, trialEndTs: 0 };
      await writeOfflineCache(cachedStatus);
      return cachedStatus;
    }

    if (result.status === 'trial') {
      cachedStatus = { status: 'trial', daysLeft: result.days_left, expired: false, expireTs: 0, trialEndTs: result.trial_end_ts };
      await writeOfflineCache(cachedStatus);
      return cachedStatus;
    }

    if (result.status === 'expired') {
      cachedStatus = { status: 'expired', daysLeft: 0, expired: true, expireTs: 0, trialEndTs: result.trial_end_ts };
      await writeOfflineCache(cachedStatus);
      return cachedStatus;
    }

    // not_found → register trial
    if (result.status === 'not_found') {
      return await initTrial();
    }
  } catch (err) {
    log.warn('API unreachable, trying offline cache', err);
  }

  // 3. API failed → use offline cache
  const offlineCache = await readOfflineCache();
  if (offlineCache) {
    log.info('Using offline cache', { status: offlineCache.status, daysLeft: offlineCache.daysLeft });
    cachedStatus = offlineCache;
    lastCheckTs = now;

    // Recalculate days left
    let daysLeft = offlineCache.daysLeft;
    if (offlineCache.status === 'active' && offlineCache.expireTs > 0) {
      daysLeft = Math.ceil((offlineCache.expireTs - now) / (24 * 60 * 60 * 1000));
    }
    if (offlineCache.status === 'trial' && offlineCache.trialEndTs > 0) {
      daysLeft = Math.ceil((offlineCache.trialEndTs - now) / (24 * 60 * 60 * 1000));
    }

    return { status: offlineCache.status, daysLeft: Math.max(0, daysLeft), expired: offlineCache.expired };
  }

  // 4. No cache, no API → error
  log.error('No cache and API unreachable');
  return { status: 'error', daysLeft: 0, expired: true };
}

/**
 * Init trial - via Worker API
 */
export async function initTrial(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
}> {
  const fingerprint = await getFingerprint();
  const version = chrome.runtime.getManifest().version;

  log.info('Registering trial', { fingerprint: fingerprint?.substring(0, 16) });

  try {
    const result = await registerTrial(fingerprint, version);
    if (result.success) {
      const daysLeft = Math.ceil((result.trial_end_ts - Date.now()) / (24 * 60 * 60 * 1000));
      cachedStatus = { status: 'trial', daysLeft, expired: false, expireTs: 0, trialEndTs: result.trial_end_ts };
      lastCheckTs = Date.now();
      log.info('Trial registered', { daysLeft });
      return cachedStatus;
    } else {
      log.error('Trial registration failed', { message: result.message });
      return { status: 'error', daysLeft: 0, expired: true };
    }
  } catch (err) {
    log.error('Trial registration error', err);
    return { status: 'error', daysLeft: 0, expired: true };
  }
}

/**
 * Activate with code
 */
export async function activateCode(code: string): Promise<{
  valid: boolean;
  error: string | null;
  status?: string;
  daysLeft?: number;
}> {
  // Already active?
  if (cachedStatus?.status === 'active' && !cachedStatus.expired) {
    return { valid: true, error: null, ...cachedStatus };
  }

  const fingerprint = await getFingerprint();

  try {
    const result = await apiActivate(code, fingerprint);
    if (result.success) {
      const daysLeft = Math.ceil((result.expire_ts - Date.now()) / (24 * 60 * 60 * 1000));
      cachedStatus = { status: 'active', daysLeft, expired: false, expireTs: result.expire_ts, trialEndTs: 0 };
      lastCheckTs = Date.now();
      log.info('Activated', { daysLeft });
      return { valid: true, error: null, ...cachedStatus };
    } else {
      log.warn('Activation failed', { error: result.error });
      return { valid: false, error: result.error || 'Activation failed' };
    }
  } catch (err) {
    log.error('Activation error', err);
    return { valid: false, error: 'Server unreachable' };
  }
}

/**
 * Clear cache (for testing)
 */
export async function clearLicense(): Promise<void> {
  cachedStatus = null;
  lastCheckTs = 0;
  log.info('Cache cleared');
}

/**
 * Require valid license - throws if expired
 * Call this before using any feature
 */
export async function requireLicense(): Promise<void> {
  const status = await checkLicense();
  if (status.expired || status.status === 'expired' || status.status === 'error') {
    throw new Error('License expired');
  }
}
