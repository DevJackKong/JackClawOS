# @jackclaw/node

JackClaw node agent — registers to Hub, reports daily memory, receives tasks.

## Start

```bash
npm run build && npm start
```

First run auto-creates:
- `~/.jackclaw/identity.json` — RSA key pair + node ID
- `~/.jackclaw/config.json` — editable config

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health + node ID |
| POST | `/api/task` | Receive task from Hub |
| POST | `/api/ping` | Ping |

## Config (`~/.jackclaw/config.json`)

| Field | Default | Description |
|-------|---------|-------------|
| `hubUrl` | `http://localhost:18999` | Hub server URL |
| `port` | `19000` | Local HTTP port |
| `reportCron` | `0 8 * * *` | Report schedule (cron) |
| `workspaceDir` | `~/.openclaw/workspace` | OpenClaw memory dir |
| `hubPublicKey` | _(unset)_ | Hub RSA public key PEM |
| `visibility.shareMemory` | `true` | Include memory in reports |
| `visibility.shareTasks` | `true` | Accept tasks from Hub |
| `visibility.redactPatterns` | `[]` | Regex patterns to redact |

## Security

- Node identity is persisted with `chmod 600`
- Reports are encrypted with Hub's public key (if configured)
- Messages are signed with node's private key
- Redact patterns strip sensitive content before sending
