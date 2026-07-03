# License Worker (Cloudflare Worker)

## 功能

- 访问/下载统计（原有功能）
- 试用期注册（防重复注册）
- 激活码验证（一码一设备）
- 有效期检查（服务端时间）

## 部署步骤

### 1. 安装依赖

```bash
cd worker-license
npm install
```

### 2. 创建 KV 命名空间

```bash
wrangler kv namespace create LICENSE_KV
# 记录输出的 ID，更新到 wrangler.toml
```

### 3. 配置 wrangler.toml

```toml
# 更新 KV namespace ID
[[kv_namespaces]]
binding = "LICENSE_KV"
id = "你的KV_NAMESPACE_ID"

# 设置密钥
[vars]
MASTER_SECRET = "你的管理密钥"
```

### 4. 部署

```bash
npm run deploy
```

### 5. 验证

```bash
# 测试统计接口
curl https://lingbot-stats.lingbot.workers.dev/api/stats

# 测试试用注册
curl -X POST https://lingbot-stats.lingbot.workers.dev/api/trial/register \
  -H "Content-Type: application/json" \
  -d '{"fingerprint":"test123","version":"2.0.2"}'

# 测试激活
curl -X POST https://lingbot-stats.lingbot.workers.dev/api/activate \
  -H "Content-Type: application/json" \
  -d '{"code":"AIB-XXXX-XXXX-XXXX","fingerprint":"test123"}'

# 测试检查
curl https://lingbot-stats.lingbot.workers.dev/api/check/test123
```

## API 接口

### POST /api/trial/register

注册试用期（首次安装时调用）

**请求：**
```json
{
  "fingerprint": "设备指纹",
  "version": "2.0.2"
}
```

**响应：**
```json
{
  "success": true,
  "trial_end_ts": 1735689600000,
  "message": "Trial registered"
}
```

### POST /api/activate

激活码激活

**请求：**
```json
{
  "code": "AIB-XXXX-XXXX-XXXX",
  "fingerprint": "设备指纹"
}
```

**响应：**
```json
{
  "success": true,
  "expire_ts": 1735689600000,
  "message": "Activation successful"
}
```

### GET /api/check/:fingerprint

检查授权状态

**响应：**
```json
{
  "status": "active",
  "expire_ts": 1735689600000,
  "trial_end_ts": 0,
  "days_left": 25
}
```

## 安全说明

- 激活码绑定设备指纹，一码一用
- 试用期注册防重复（同一设备只能注册一次）
- 服务端时间验证，防篡改
- 离线时回退到本地缓存（降级体验）
