// Cloudflare Worker — LingBot 访问/下载统计
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

      // 404
      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};
