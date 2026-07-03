/**
 * Cloudflare Worker - Stats + License API
 *
 * Endpoints:
 *   POST /api/visit              - Record visit (existing)
 *   POST /api/download           - Record download (existing)
 *   GET  /api/stats              - Get stats (existing)
 *
 *   POST /api/trial/register     - Register trial for a device
 *   POST /api/activate           - Activate with code
 *   GET  /api/check/:fingerprint - Check license status
 *   POST /api/deactivate         - Deactivate a code (admin)
 */

interface Env {
  LICENSE_KV: KVNamespace;
  MASTER_SECRET: string;
  TRIAL_DAYS: string;
  DEFAULT_ACTIVATION_DAYS: string;
}

interface TrialRecord {
  fingerprint: string;
  trial_end_ts: number;
  registered_at: number;
  version: string;
}

interface ActivationRecord {
  code: string;
  fingerprint: string;
  expire_ts: number;
  activated_at: number;
  version: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── Stats endpoints (existing) ──

      if (path === '/api/visit' && request.method === 'POST') {
        const count = parseInt(await env.LICENSE_KV.get('stats:visits') || '0') + 1;
        await env.LICENSE_KV.put('stats:visits', count.toString());
        return jsonResponse({ visits: count }, 200, corsHeaders);
      }

      if (path === '/api/download' && request.method === 'POST') {
        const count = parseInt(await env.LICENSE_KV.get('stats:downloads') || '0') + 1;
        await env.LICENSE_KV.put('stats:downloads', count.toString());
        return jsonResponse({ downloads: count }, 200, corsHeaders);
      }

      if (path === '/api/stats' && request.method === 'GET') {
        const visits = parseInt(await env.LICENSE_KV.get('stats:visits') || '0');
        const downloads = parseInt(await env.LICENSE_KV.get('stats:downloads') || '0');
        return jsonResponse({ visits, downloads }, 200, corsHeaders);
      }

      // ── License endpoints ──

      if (path === '/api/trial/register' && request.method === 'POST') {
        return await handleTrialRegister(request, env, corsHeaders);
      }

      if (path === '/api/activate' && request.method === 'POST') {
        return await handleActivate(request, env, corsHeaders);
      }

      if (path.startsWith('/api/check/') && request.method === 'GET') {
        const fingerprint = path.split('/api/check/')[1];
        return await handleCheck(fingerprint, env, corsHeaders);
      }

      if (path === '/api/deactivate' && request.method === 'POST') {
        return await handleDeactivate(request, env, corsHeaders);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

/**
 * Register trial for a device
 */
async function handleTrialRegister(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const body = await request.json() as { fingerprint: string; version: string };
  const { fingerprint, version } = body;

  if (!fingerprint) {
    return jsonResponse({ success: false, error: 'Missing fingerprint' }, 400, corsHeaders);
  }

  // Check if already registered
  const existing = await env.LICENSE_KV.get(`trial:${fingerprint}`, 'json') as TrialRecord | null;
  if (existing) {
    return jsonResponse({
      success: true,
      trial_end_ts: existing.trial_end_ts,
      message: 'Trial already registered',
    }, 200, corsHeaders);
  }

  // Register new trial
  const trialDays = parseInt(env.TRIAL_DAYS) || 7;
  const now = Date.now();
  const trial_end_ts = now + trialDays * 24 * 60 * 60 * 1000;

  const record: TrialRecord = {
    fingerprint,
    trial_end_ts,
    registered_at: now,
    version: version || 'unknown',
  };

  await env.LICENSE_KV.put(`trial:${fingerprint}`, JSON.stringify(record));

  return jsonResponse({
    success: true,
    trial_end_ts,
    message: 'Trial registered',
  }, 200, corsHeaders);
}

/**
 * Activate with code
 */
async function handleActivate(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const body = await request.json() as { code: string; fingerprint: string };
  const { code, fingerprint } = body;

  if (!code || !fingerprint) {
    return jsonResponse({ success: false, error: 'Missing code or fingerprint' }, 400, corsHeaders);
  }

  // Check if code is already activated by another device
  const existingActivation = await env.LICENSE_KV.get(`code:${code}`, 'json') as ActivationRecord | null;
  if (existingActivation) {
    if (existingActivation.fingerprint !== fingerprint) {
      return jsonResponse({
        success: false,
        error: 'Code already activated on another device',
      }, 400, corsHeaders);
    }
    // Same device, check if still active
    if (existingActivation.expire_ts > Date.now()) {
      return jsonResponse({
        success: true,
        expire_ts: existingActivation.expire_ts,
        message: 'Code already active on this device',
      }, 200, corsHeaders);
    }
  }

  // Validate code format
  if (!code.startsWith('AIB-') || code.length < 15) {
    return jsonResponse({ success: false, error: 'Invalid code format' }, 400, corsHeaders);
  }

  // Calculate expiration
  const activationDays = parseInt(env.DEFAULT_ACTIVATION_DAYS) || 30;
  const now = Date.now();
  const expire_ts = now + activationDays * 24 * 60 * 60 * 1000;

  // Store activation record
  const record: ActivationRecord = {
    code,
    fingerprint,
    expire_ts,
    activated_at: now,
    version: 'current',
  };

  await env.LICENSE_KV.put(`code:${code}`, JSON.stringify(record));
  await env.LICENSE_KV.put(`device:${fingerprint}`, JSON.stringify(record));

  return jsonResponse({
    success: true,
    expire_ts,
    message: 'Activation successful',
  }, 200, corsHeaders);
}

/**
 * Check license status
 */
async function handleCheck(fingerprint: string, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (!fingerprint) {
    return jsonResponse({ error: 'Missing fingerprint' }, 400, corsHeaders);
  }

  const now = Date.now();

  // Check activation first
  const activation = await env.LICENSE_KV.get(`device:${fingerprint}`, 'json') as ActivationRecord | null;
  if (activation && activation.expire_ts > now) {
    const days_left = Math.ceil((activation.expire_ts - now) / (24 * 60 * 60 * 1000));
    return jsonResponse({
      status: 'active',
      expire_ts: activation.expire_ts,
      trial_end_ts: 0,
      days_left,
    }, 200, corsHeaders);
  }

  // Check trial
  const trial = await env.LICENSE_KV.get(`trial:${fingerprint}`, 'json') as TrialRecord | null;
  if (trial) {
    if (trial.trial_end_ts > now) {
      const days_left = Math.ceil((trial.trial_end_ts - now) / (24 * 60 * 60 * 1000));
      return jsonResponse({
        status: 'trial',
        expire_ts: 0,
        trial_end_ts: trial.trial_end_ts,
        days_left,
      }, 200, corsHeaders);
    } else {
      return jsonResponse({
        status: 'expired',
        expire_ts: 0,
        trial_end_ts: trial.trial_end_ts,
        days_left: 0,
      }, 200, corsHeaders);
    }
  }

  // Not found
  return jsonResponse({
    status: 'not_found',
    expire_ts: 0,
    trial_end_ts: 0,
    days_left: 0,
  }, 200, corsHeaders);
}

/**
 * Deactivate a code (admin function)
 */
async function handleDeactivate(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const body = await request.json() as { code: string; secret: string };
  const { code, secret } = body;

  if (secret !== env.MASTER_SECRET) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401, corsHeaders);
  }

  if (!code) {
    return jsonResponse({ success: false, error: 'Missing code' }, 400, corsHeaders);
  }

  await env.LICENSE_KV.delete(`code:${code}`);

  return jsonResponse({
    success: true,
    message: 'Code deactivated',
  }, 200, corsHeaders);
}

/**
 * Helper: JSON response
 */
function jsonResponse(data: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
