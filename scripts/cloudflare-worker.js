// Cloudflare Worker — LingBot 统计 + 授权系统
// 部署到 Cloudflare Workers，绑定 KV Namespace（名称：STATS）
//
// KV Namespace 需要在 Cloudflare 控制台手动创建：
//   1. 左侧菜单 → Workers 和 Pages → KV
//   2. 创建命名空间 → 名称填 STATS
//   3. 回到 Worker → 设置 → 变量 → KV 命名空间绑定 → 添加 → 变量名填 STATS，选择刚创建的命名空间

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── 统计接口（原有） ──

      // POST /api/visit — 访问 +1
      if (url.pathname === '/api/visit' && request.method === 'POST') {
        const current = parseInt(await env.STATS.get('visits') || '0');
        const newCount = current + 1;
        await env.STATS.put('visits', String(newCount));
        return Response.json({ visits: newCount }, { headers: corsHeaders });
      }

      // POST /api/download — 下载 +1
      if (url.pathname === '/api/download' && request.method === 'POST') {
        const current = parseInt(await env.STATS.get('downloads') || '0');
        const newCount = current + 1;
        await env.STATS.put('downloads', String(newCount));
        return Response.json({ downloads: newCount }, { headers: corsHeaders });
      }

      // GET /api/stats — 获取当前统计
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        const visits = parseInt(await env.STATS.get('visits') || '0');
        const downloads = parseInt(await env.STATS.get('downloads') || '0');
        return Response.json({ visits, downloads }, { headers: corsHeaders });
      }

      // ── 授权接口（新增） ──

      // POST /api/trial/register — 注册试用期
      if (url.pathname === '/api/trial/register' && request.method === 'POST') {
        const body = await request.json();
        const { fingerprint, version } = body;

        if (!fingerprint) {
          return Response.json({ success: false, error: 'Missing fingerprint' }, { status: 400, headers: corsHeaders });
        }

        // 检查是否已注册
        const existing = await env.STATS.get(`trial:${fingerprint}`, { type: 'json' });
        if (existing) {
          return Response.json({
            success: true,
            trial_end_ts: existing.trial_end_ts,
            message: 'Trial already registered',
          }, { headers: corsHeaders });
        }

        // 注册新试用期
        const trialDays = 7;
        const now = Date.now();
        const trial_end_ts = now + trialDays * 24 * 60 * 60 * 1000;

        await env.STATS.put(`trial:${fingerprint}`, JSON.stringify({
          fingerprint,
          trial_end_ts,
          registered_at: now,
          version: version || 'unknown',
        }));

        return Response.json({
          success: true,
          trial_end_ts,
          message: 'Trial registered',
        }, { headers: corsHeaders });
      }

      // POST /api/activate — 激活码激活
      if (url.pathname === '/api/activate' && request.method === 'POST') {
        const body = await request.json();
        const { code, fingerprint } = body;

        if (!code || !fingerprint) {
          return Response.json({ success: false, error: 'Missing code or fingerprint' }, { status: 400, headers: corsHeaders });
        }

        // 检查激活码是否已被其他设备使用
        const existingActivation = await env.STATS.get(`code:${code}`, { type: 'json' });
        if (existingActivation && existingActivation.fingerprint !== fingerprint) {
          return Response.json({
            success: false,
            error: 'Code already activated on another device',
          }, { status: 400, headers: corsHeaders });
        }

        // 同一设备重复激活
        if (existingActivation && existingActivation.fingerprint === fingerprint) {
          if (existingActivation.expire_ts > Date.now()) {
            return Response.json({
              success: true,
              expire_ts: existingActivation.expire_ts,
              message: 'Code already active on this device',
            }, { headers: corsHeaders });
          }
        }

        // 验证激活码格式
        if (!code.startsWith('AIB-') || code.length < 15) {
          return Response.json({ success: false, error: 'Invalid code format' }, { status: 400, headers: corsHeaders });
        }

        // 计算过期时间
        const activationDays = 30;
        const now = Date.now();
        const expire_ts = now + activationDays * 24 * 60 * 60 * 1000;

        // 存储激活记录
        const record = {
          code,
          fingerprint,
          expire_ts,
          activated_at: now,
        };

        await env.STATS.put(`code:${code}`, JSON.stringify(record));
        await env.STATS.put(`device:${fingerprint}`, JSON.stringify(record));

        return Response.json({
          success: true,
          expire_ts,
          message: 'Activation successful',
        }, { headers: corsHeaders });
      }

      // GET /api/check/:fingerprint — 检查授权状态
      if (url.pathname.startsWith('/api/check/') && request.method === 'GET') {
        const fingerprint = url.pathname.split('/api/check/')[1];

        if (!fingerprint) {
          return Response.json({ error: 'Missing fingerprint' }, { status: 400, headers: corsHeaders });
        }

        const now = Date.now();

        // 检查激活状态
        const activation = await env.STATS.get(`device:${fingerprint}`, { type: 'json' });
        if (activation && activation.expire_ts > now) {
          const days_left = Math.ceil((activation.expire_ts - now) / (24 * 60 * 60 * 1000));
          return Response.json({
            status: 'active',
            expire_ts: activation.expire_ts,
            trial_end_ts: 0,
            days_left,
          }, { headers: corsHeaders });
        }

        // 检查试用期
        const trial = await env.STATS.get(`trial:${fingerprint}`, { type: 'json' });
        if (trial) {
          if (trial.trial_end_ts > now) {
            const days_left = Math.ceil((trial.trial_end_ts - now) / (24 * 60 * 60 * 1000));
            return Response.json({
              status: 'trial',
              expire_ts: 0,
              trial_end_ts: trial.trial_end_ts,
              days_left,
            }, { headers: corsHeaders });
          } else {
            return Response.json({
              status: 'expired',
              expire_ts: 0,
              trial_end_ts: trial.trial_end_ts,
              days_left: 0,
            }, { headers: corsHeaders });
          }
        }

        // 未找到记录
        return Response.json({
          status: 'not_found',
          expire_ts: 0,
          trial_end_ts: 0,
          days_left: 0,
        }, { headers: corsHeaders });
      }

      // POST /api/deactivate — 停用激活码（管理员）
      if (url.pathname === '/api/deactivate' && request.method === 'POST') {
        const body = await request.json();
        const { code, secret } = body;

        if (secret !== env.MASTER_SECRET) {
          return Response.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
        }

        if (!code) {
          return Response.json({ success: false, error: 'Missing code' }, { status: 400, headers: corsHeaders });
        }

        await env.STATS.delete(`code:${code}`);

        return Response.json({
          success: true,
          message: 'Code deactivated',
        }, { headers: corsHeaders });
      }

      // 404
      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};
