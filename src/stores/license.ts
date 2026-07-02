/**
 * License Store - Pinia Setup Store
 *
 * Manages license state (status, daysLeft, expired).
 * All logic delegated to wasm via wasm-loader.
 * This store only exposes reactive state to Vue components.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Logger } from '@/src/utils/logger';
import {
  initWasm,
  initTrial,
  checkLicense,
  activateCode,
  tick,
  clearLicense,
  getCachedStatus,
} from '@/src/license/wasm-loader';

const log = new Logger('Store:License');

export const useLicenseStore = defineStore('aib-license', () => {
  // ── State ──

  /** Current license status */
  const status = ref<string>('unknown');

  /** Days remaining */
  const daysLeft = ref<number>(0);

  /** Whether wasm module is loaded */
  const initialized = ref<boolean>(false);

  /** Loading state */
  const loading = ref<boolean>(false);

  /** Error message */
  const error = ref<string | null>(null);

  // ── Computed ──

  /** Whether license is active (trial or activated) */
  const isActive = computed(() => {
    console.log('[license] isActive computed, status:', status.value);
    return status.value === 'trial' || status.value === 'active';
  });

  /** Whether trial period */
  const isTrial = computed(() => {
    console.log('[license] isTrial computed, status:', status.value);
    return status.value === 'trial';
  });

  /** Whether activated (paid) */
  const isActivated = computed(() => {
    console.log('[license] isActivated computed, status:', status.value);
    return status.value === 'active';
  });

  /** Whether expired */
  const isExpired = computed(() => {
    console.log('[license] isExpired computed, status:', status.value);
    return status.value === 'expired';
  });

  /** Status display text */
  const statusText = computed(() => {
    switch (status.value) {
      case 'trial':
        return `试用期 (${daysLeft.value} 天)`;
      case 'active':
        return `已激活 (${daysLeft.value} 天)`;
      case 'expired':
        return '已过期';
      default:
        return '未初始化';
    }
  });

  // ── Actions ──

  /**
   * Initialize license system
   * Call this on app startup (App.vue onMounted)
   */
  async function init(): Promise<void> {
    console.log('[license] init called, initialized:', initialized.value);
    if (initialized.value) return;

    loading.value = true;
    error.value = null;

    try {
      // Load wasm module
      await initWasm();

      // Check existing license or init trial
      const result = await checkLicense();

      // If corrupted (old build data), clear and re-init trial
      if (result.status === 'corrupted') {
        log.warn('License data corrupted, reinitializing trial');
        await clearLicense();
        const trial = await checkLicense(); // Will call initTrial
        status.value = trial.status;
        daysLeft.value = trial.daysLeft;
      } else {
        status.value = result.status;
        daysLeft.value = result.daysLeft;
      }
      initialized.value = true;

      log.info('License initialized', { status: status.value, daysLeft: daysLeft.value });
    } catch (err) {
      error.value = String(err);
      log.error('License initialization failed', err);
      // Wasm failed to load - don't block the app, allow trial
      status.value = 'trial';
      daysLeft.value = 7;
      initialized.value = true;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Activate license with code
   */
  async function activate(code: string): Promise<{ success: boolean; error?: string }> {
    loading.value = true;
    error.value = null;

    try {
      const result = await activateCode(code);

      if (result.valid) {
        status.value = result.status || 'active';
        daysLeft.value = result.daysLeft || 0;
        log.info('License activated', { daysLeft: result.daysLeft });
        return { success: true };
      } else {
        error.value = result.error || '激活失败';
        return { success: false, error: result.error || '激活失败' };
      }
    } catch (err) {
      error.value = String(err);
      return { success: false, error: String(err) };
    } finally {
      loading.value = false;
    }
  }

  /**
   * Track user action
   * Call this on every user operation (chat, voice, automation)
   */
  async function trackAction(action: 'chat' | 'voice' | 'automation'): Promise<void> {
    if (!initialized.value) return;
    try {
      await tick(action);
    } catch (err) {
      log.error('Track action failed', err);
    }
  }

  /**
   * Refresh license status
   */
  async function refresh(): Promise<void> {
    if (!initialized.value) return;
    try {
      const result = await checkLicense();
      status.value = result.status;
      daysLeft.value = result.daysLeft;
    } catch (err) {
      log.error('Refresh failed', err);
    }
  }

  /**
   * Clear license data (for testing)
   */
  async function reset(): Promise<void> {
    await clearLicense();
    status.value = 'unknown';
    daysLeft.value = 0;
    initialized.value = false;
  }

  return {
    // State
    status,
    daysLeft,
    initialized,
    loading,
    error,

    // Computed
    isActive,
    isTrial,
    isActivated,
    isExpired,
    statusText,

    // Actions
    init,
    activate,
    trackAction,
    refresh,
    reset,
  };
});
