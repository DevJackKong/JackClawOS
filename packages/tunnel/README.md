# @jackclaw/tunnel

Network tunnel management for JackClaw nodes.

Supports two modes:
- **cloudflare** — zero-config public URL via [cloudflared](https://github.com/cloudflare/cloudflared) quick tunnels (`*.trycloudflare.com`)
- **selfhosted** — local self-signed HTTPS wrapping any HTTP port (LAN / VPN)

---

## Quick Start

```ts
import { TunnelManager } from '@jackclaw/tunnel';

const tunnel = new TunnelManager();
const url = await tunnel.start(3000, 'cloudflare');
console.log('Public URL:', url); // https://abc123.trycloudflare.com

// later…
await tunnel.stop();
```

---

## Requirements

### cloudflare mode
`cloudflared` must be installed and in `$PATH`:

| Platform | Install |
|----------|---------|
| macOS    | `brew install cloudflared` |
| Linux    | `curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared` |
| Windows  | [Download installer](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |

### selfhosted mode
`openssl` must be in `$PATH` (standard on macOS / most Linux distros).

---

## API

### `TunnelManager`

```ts
const tm = new TunnelManager(opts?: TunnelManagerOptions);

// Start tunnel
const publicUrl: string = await tm.start(port, 'cloudflare' | 'selfhosted');

// Query
tm.getPublicUrl();   // string | null
tm.isRunning();      // boolean
tm.getMode();        // 'cloudflare' | 'selfhosted' | null

// Stop
await tm.stop();
```

#### `TunnelManagerOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoRestart` | `boolean` | `true` | Auto-restart cloudflared on crash |
| `selfHostedHostname` | `string` | `'localhost'` | Hostname in self-signed cert |
| `selfHostedPort` | `number` | `0` (random) | Fixed HTTPS port for self-hosted |
| `onUrl` | `(url: string) => void` | — | Callback when URL is resolved |

---

### Low-level: `CloudflareTunnel`

```ts
import { CloudflareTunnel } from '@jackclaw/tunnel';

const t = new CloudflareTunnel({ port: 3000, onUrl: console.log });
const url = await t.start();  // resolves when URL is available
t.stop();
```

Persisted URL stored at `~/.jackclaw/tunnel.json`.

---

### Low-level: `SelfHostedTunnel`

```ts
import { SelfHostedTunnel } from '@jackclaw/tunnel';

const t = new SelfHostedTunnel({ targetPort: 3000, httpsPort: 8443 });
const url = await t.start();  // https://localhost:8443
await t.stop();
```

---

## Persistence

When a cloudflare URL is resolved it is written to `~/.jackclaw/tunnel.json`:

```json
{
  "url": "https://abc123.trycloudflare.com",
  "port": 3000,
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

Read it back:

```ts
import { readPersistedTunnel } from '@jackclaw/tunnel';
const info = readPersistedTunnel(); // { url, port, updatedAt } | null
```

---

## CLI Integration

The `jackclaw init` command will ask whether to enable tunnel mode during setup.

```
$ jackclaw init
? Node name: my-node
? Node role: node
? Enable tunnel? (public URL via cloudflared) Yes
? Tunnel mode: cloudflare
✓ Node initialized
  Public URL  https://abc123.trycloudflare.com
```
