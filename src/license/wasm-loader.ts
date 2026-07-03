/**
 * License Loader - Pure Local Approach
 *
 * - Trial: chrome.storage, 7 days, fingerprint-based
 * - Activation: local wasm HMAC verification
 * - No network dependency
 */

import { Logger } from '@/src/utils/logger';
import { generateFingerprint } from './fingerprint';
import { TRIAL_DAYS, ACTIVATION_DAYS, CACHE_TTL_HOURS } from './config';

const log = new Logger('License:WasmLoader');

/** Storage keys */
const LICENSE_KEY = 'aib-license';

/** Wasm module instance */
let wasmModule: any = null;

/** Current fingerprint */
let currentFingerprint: string | null = null;

/** Memory cache */
let cachedLicense: LicenseData | null = null;

interface LicenseData {
  status: 'trial' | 'active' | 'expired';
  fingerprint: string;
  expireTs: number;    // 0 for trial
  trialEndTs: number;  // 0 for active
  activatedAt: number;
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
 * Read license from chrome.storage
 */
async function readLicense(): Promise<LicenseData | null> {
  if (cachedLicense) return cachedLicense;
  try {
    const result = await chrome.storage.local.get(LICENSE_KEY);
    cachedLicense = result[LICENSE_KEY] || null;
    return cachedLicense;
  } catch {
    return null;
  }
}

/**
 * Write license to chrome.storage
 */
async function writeLicense(data: LicenseData): Promise<void> {
  try {
    await chrome.storage.local.set({ [LICENSE_KEY]: data });
    cachedLicense = data;
    log.info('License saved', { status: data.status });
  } catch (err) {
    log.error('Failed to save license', err);
  }
}

/**
 * Check license status
 */
export async function checkLicense(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
  trialEndTs: number;
  expireTs: number;
}> {
  const now = Date.now();
  const license = await readLicense();

  if (!license) {
    // First install - register trial
    return await initTrial();
  }

  // Check if expired
  if (license.status === 'trial' && license.trialEndTs > 0 && now > license.trialEndTs) {
    return { status: 'expired', daysLeft: 0, expired: true, trialEndTs: license.trialEndTs, expireTs: 0 };
  }
  if (license.status === 'active' && license.expireTs > 0 && now > license.expireTs) {
    return { status: 'expired', daysLeft: 0, expired: true, trialEndTs: 0, expireTs: license.expireTs };
  }

  // Calculate days left
  let daysLeft = 0;
  if (license.status === 'trial' && license.trialEndTs > 0) {
    daysLeft = Math.ceil((license.trialEndTs - now) / (24 * 60 * 60 * 1000));
  }
  if (license.status === 'active' && license.expireTs > 0) {
    daysLeft = Math.ceil((license.expireTs - now) / (24 * 60 * 60 * 1000));
  }

  log.info('checkLicense result', { status: license.status, daysLeft, trialEndTs: license.trialEndTs, now });

  return {
    status: license.status,
    daysLeft: Math.max(0, daysLeft),
    expired: false,
    trialEndTs: license.trialEndTs || 0,
    expireTs: license.expireTs || 0,
  };
}

/**
 * Init trial period
 */
export async function initTrial(): Promise<{
  status: string;
  daysLeft: number;
  expired: boolean;
  trialEndTs: number;
  expireTs: number;
}> {
  const fingerprint = await getFingerprint();
  const now = Date.now();

  log.info('initTrial config', { TRIAL_DAYS, ACTIVATION_DAYS });

  const trialEndTs = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil(TRIAL_DAYS);

  const license: LicenseData = {
    status: 'trial',
    fingerprint,
    expireTs: 0,
    trialEndTs,
    activatedAt: now,
  };

  await writeLicense(license);
  log.info('Trial initialized', { trialEndTs, daysLeft });

  return { status: 'trial', daysLeft, expired: false, trialEndTs, expireTs: 0 };
}

/**
 * Activate with code (local HMAC verification)
 */
export async function activateCode(code: string): Promise<{
  valid: boolean;
  error: string | null;
  status?: string;
  daysLeft?: number;
}> {
  // Already active?
  const current = await checkLicense();
  if (current.status === 'active' && !current.expired) {
    return { valid: true, error: null, ...current };
  }

  const fingerprint = await getFingerprint();
  const wasm = getWasm();

  // Verify code using wasm (local HMAC verification)
  const now = BigInt(Date.now());
  const resultJson = wasm.verify_code(code, fingerprint, now);
  log.info('verify_code result:', resultJson);

  const result = JSON.parse(resultJson);
  if (!result.valid) {
    return { valid: false, error: result.error || 'Invalid code' };
  }

  // Code valid - activate
  const expireTs = Date.now() + ACTIVATION_DAYS * 24 * 60 * 60 * 1000;
  const license: LicenseData = {
    status: 'active',
    fingerprint,
    expireTs,
    trialEndTs: 0,
    activatedAt: Date.now(),
  };

  await writeLicense(license);
  log.info('Activated', { expireTs, days: ACTIVATION_DAYS });

  return {
    valid: true,
    error: null,
    status: 'active',
    daysLeft: ACTIVATION_DAYS,
  };
}

/**
 * Clear license (for testing)
 */
export async function clearLicense(): Promise<void> {
  await chrome.storage.local.remove(LICENSE_KEY);
  cachedLicense = null;
  log.info('License cleared');
}

/**
 * Require valid license - throws if expired
 */
export async function requireLicense(): Promise<void> {
  const status = await checkLicense();
  if (status.expired || status.status === 'expired') {
    throw new Error('License expired');
  }
}
