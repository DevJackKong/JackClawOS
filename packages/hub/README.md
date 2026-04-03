# @jackclaw/hub

JackClaw Hub — CEO's central node. Receives encrypted reports from all registered agent nodes.

## Architecture

```
Node A ──┐
Node B ──┼──► POST /api/report ──► Hub ──► ~/.jackclaw/hub/reports/
Node C ──┘
                                   Hub ──► GET /api/summary  (CEO)
                                   Hub ──► GET /api/nodes    (CEO)
```

## API

### Public (no auth)

**POST /api/register**
```json
// Request
{ "nodeId": "node-alpha", "name": "Alpha", "role": "dev", "publicKey": "-----BEGIN PUBLIC KEY-----..." }

// Response
{ "success": true, "hubPublicKey": "...", "token": "<JWT>", "node": { ... } }
```

### Authenticated (Bearer JWT)

**POST /api/report**
```json
// JackClawMessage format (payload is base64(JSON(EncryptedPayload)))
{
  "from": "node-alpha",
  "to": "hub",
  "type": "report",
  "payload": "<base64-encrypted>",
  "timestamp": 1712100000000,
  "signature": "<base64-RSA-SHA256>"
}
```

**GET /api/nodes** *(CEO role only)*
```json
{ "success": true, "total": 3, "nodes": [ { "nodeId": "...", "lastReportAt": 1712100000000, ... } ] }
```

**GET /api/summary?date=2024-04-03** *(all roles)*
```json
{
  "date": "2024-04-03",
  "byRole": {
    "dev": { "role": "dev", "nodes": [ { "nodeId": "...", "summary": "..." } ] }
  },
  "totalNodes": 5,
  "reportingNodes": 3
}
```

## Security

- **JWT** — nodes authenticate with tokens issued at registration (30-day expiry)
- **Signature verification** — every report is RSA-SHA256 verified against the registered node public key
- **E2E encryption** — payloads are AES-256-GCM encrypted, key wrapped with hub's RSA-4096 public key
- **Rate limiting** — 60 requests/min per IP
- **CEO-only routes** — `/api/nodes` requires `role: "ceo"` in JWT

## Data Storage

```
~/.jackclaw/hub/
├── keys.json          # Hub RSA key pair (chmod 600)
├── jwt-secret         # JWT signing secret (chmod 600)
├── nodes.json         # Registered node registry
└── reports/
    └── [nodeId]/
        └── [YYYY-MM-DD].json
```

## Usage

```bash
# Install deps
npm install

# Build
npm run build

# Run (default port 3100)
npm start

# Dev mode
npm run dev

# Custom port
HUB_PORT=4000 npm start
```
