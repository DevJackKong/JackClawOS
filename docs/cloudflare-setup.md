# Cloudflare Setup Guide for JackClaw Hub

Deploy your JackClaw Hub behind Cloudflare for DDoS protection, WAF, SSL, and bot mitigation.

## Prerequisites

- A domain name (e.g., `hub.jackclaw.ai`)
- Cloudflare account (free tier works)
- JackClaw Hub running on a server

## Step 1: DNS Configuration

1. Add your domain to Cloudflare
2. Set DNS records:

```
Type  | Name    | Content           | Proxy
A     | hub     | YOUR_SERVER_IP    | Proxied (orange cloud)
AAAA  | hub     | YOUR_IPV6         | Proxied (optional)
```

**Important**: Keep the orange cloud (Proxied) enabled — this routes traffic through Cloudflare.

## Step 2: SSL/TLS Settings

Go to **SSL/TLS** → **Overview**:
- Set encryption mode to **Full (strict)**
- Enable **Always Use HTTPS**
- Enable **Automatic HTTPS Rewrites**

Go to **SSL/TLS** → **Edge Certificates**:
- Enable **Minimum TLS Version**: TLS 1.2
- Enable **TLS 1.3**
- Enable **HSTS** (max-age: 6 months, include subdomains)

## Step 3: WAF (Web Application Firewall)

Go to **Security** → **WAF**:

### Custom Rules (Recommended)

**Rule 1: Block suspicious API abuse**
```
(http.request.uri.path contains "/api/auth/register" and 
 ip.geoip.country in {"RU" "CN" "KP"} and
 cf.threat_score gt 30)
→ Action: Block
```

**Rule 2: Rate limit registration**
```
(http.request.uri.path eq "/api/auth/register" and 
 http.request.method eq "POST")
→ Action: Rate Limit (5 requests per 10 minutes per IP)
```

**Rule 3: Rate limit messaging**
```
(http.request.uri.path contains "/api/social/send" and 
 http.request.method eq "POST")
→ Action: Rate Limit (60 requests per minute per IP)
```

**Rule 4: Block known bad bots**
```
(cf.client.bot and not cf.bot_management.verified_bot)
→ Action: Challenge (CAPTCHA)
```

### Managed Rules
- Enable **Cloudflare Managed Ruleset**
- Enable **OWASP ModSecurity Core Rule Set**

## Step 4: Bot Protection

Go to **Security** → **Bots**:
- Enable **Bot Fight Mode** (free tier)
- Set **Super Bot Fight Mode** if on Pro plan:
  - Definitely automated: Block
  - Likely automated: Challenge
  - Verified bots: Allow

## Step 5: DDoS Protection

Go to **Security** → **DDoS**:
- HTTP DDoS attack protection: **Enabled** (automatic)
- L3/L4 DDoS: **Enabled** (automatic on all plans)

Custom DDoS rules:
- If your Hub is API-only (no browser traffic), set:
  - Challenge browsers that don't execute JavaScript
  - This blocks most L7 DDoS without affecting API clients

## Step 6: Page Rules

Add these page rules:

```
1. *hub.jackclaw.ai/api/*
   - Cache Level: Bypass
   - Security Level: High
   - Browser Integrity Check: On

2. *hub.jackclaw.ai/static/*
   - Cache Level: Cache Everything
   - Edge Cache TTL: 1 month
   - Browser Cache TTL: 1 week

3. *hub.jackclaw.ai/@*
   - Cache Level: Standard
   - Edge Cache TTL: 1 hour
```

## Step 7: WebSocket Support

JackClaw uses WebSocket for real-time messaging. Cloudflare supports WebSocket on all plans.

Verify: Go to **Network** → Ensure **WebSockets** is enabled.

Your Hub's WebSocket endpoint (`/chat/ws`) will work through Cloudflare automatically.

## Step 8: Hub Configuration

Update your Hub startup to work behind Cloudflare:

```bash
# Set environment variables
export JACKCLAW_TRUST_PROXY=true    # Trust Cloudflare's X-Forwarded-For
export JACKCLAW_HUB_URL=https://hub.jackclaw.ai  # Public URL

# Start Hub
jackclaw start
```

## Step 9: Verify Setup

```bash
# Check DNS propagation
dig hub.jackclaw.ai

# Verify Cloudflare headers
curl -I https://hub.jackclaw.ai/health
# Should see: cf-ray, cf-cache-status headers

# Test WebSocket
wscat -c wss://hub.jackclaw.ai/chat/ws

# Test API
curl https://hub.jackclaw.ai/api/directory/search?q=test
```

## Alternative: Cloudflare Tunnel (Zero Trust)

For Hubs behind NAT/firewall (no public IP):

```bash
# Install cloudflared
brew install cloudflared

# Create named tunnel (persistent, fixed URL)
cloudflared tunnel create jackclaw-hub
cloudflared tunnel route dns jackclaw-hub hub.jackclaw.ai

# Run tunnel
cloudflared tunnel --config ~/.cloudflared/config.yml run jackclaw-hub
```

`~/.cloudflared/config.yml`:
```yaml
tunnel: jackclaw-hub
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: hub.jackclaw.ai
    service: http://localhost:3100
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

**Advantage**: No open ports needed. Hub stays completely behind NAT.

## Cost

| Plan | Price | Key Features |
|------|-------|-------------|
| Free | $0 | Basic WAF, DDoS, SSL, 3 Page Rules |
| Pro | $20/mo | Advanced WAF, Bot Management, 20 Page Rules |
| Business | $200/mo | Custom WAF rules, 100% SLA |

**Recommendation**: Free tier is sufficient for most self-hosted Hubs. Pro if you expect significant traffic.

---

*For more details, see [Cloudflare Docs](https://developers.cloudflare.com).*
