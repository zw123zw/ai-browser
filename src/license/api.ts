/**
 * License API Client
 *
 * Communicates with the Cloudflare Worker license server.
 * All license validation happens server-side.
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('License:API');

/** Worker API base URL */
const API_BASE = 'https://lingbot-stats.lingbot.workers.dev';

/** Request timeout in ms */
const TIMEOUT = 10000;

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface TrialResponse {
  success: boolean;
  trial_end_ts: number;
  message: string;
}

interface ActivateResponse {
  success: boolean;
  expire_ts: number;
  error?: string;
  message: string;
}

interface CheckResponse {
  status: 'trial' | 'active' | 'expired' | 'not_found';
  trial_end_ts: number;
  expire_ts: number;
  days_left: number;
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Register trial for a device
 */
export async function registerTrial(fingerprint: string, version: string): Promise<TrialResponse> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/trial/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint, version }),
    });
    const data = await response.json() as TrialResponse;
    log.info('Trial registered', { success: data.success, trial_end_ts: data.trial_end_ts });
    return data;
  } catch (err) {
    log.error('Failed to register trial', err);
    // Fallback: allow local trial if server unreachable
    return {
      success: true,
      trial_end_ts: Date.now() + 7 * 24 * 60 * 60 * 1000,
      message: 'Offline trial (server unreachable)',
    };
  }
}

/**
 * Activate with code
 */
export async function activateCode(code: string, fingerprint: string): Promise<ActivateResponse> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, fingerprint }),
    });
    const data = await response.json() as ActivateResponse;
    log.info('Activation result', { success: data.success, expire_ts: data.expire_ts });
    return data;
  } catch (err) {
    log.error('Failed to activate', err);
    return {
      success: false,
      expire_ts: 0,
      error: 'Server unreachable',
      message: 'Activation failed',
    };
  }
}

/**
 * Check license status
 */
export async function checkLicense(fingerprint: string): Promise<CheckResponse> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/check/${fingerprint}`);
    const data = await response.json() as CheckResponse;
    log.info('License check', { status: data.status, days_left: data.days_left });
    return data;
  } catch (err) {
    log.error('Failed to check license', err);
    // Fallback: return unknown status if server unreachable
    return {
      status: 'not_found',
      trial_end_ts: 0,
      expire_ts: 0,
      days_left: 0,
    };
  }
}
