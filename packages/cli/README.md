# @jackclaw/cli

JackClaw CLI management tool — manage encrypted org-node identities, Hub connections, and scheduled reports.

## Install

```bash
npm install -g @jackclaw/cli
# or from monorepo root:
npm run build --workspace=packages/cli
```

## Commands

### `jackclaw init`
Initialize this machine as an JackClaw node. Generates an Ed25519 key pair and creates `~/.jackclaw/config.json`.

```bash
jackclaw init
jackclaw init --name "my-server" --role hub
```

### `jackclaw invite <hub-url>`
Register this node with a Hub. Sends public key, receives auth token.

```bash
jackclaw invite https://hub.example.com
```

### `jackclaw status`
Display node identity, Hub connection status, last/next report times.

```bash
jackclaw status
```

### `jackclaw report [--now] [--dry-run]`
Send a report to the Hub immediately.

```bash
jackclaw report --now
jackclaw report --now --dry-run   # preview without sending
```

### `jackclaw nodes`
List all registered nodes (Hub role only). Calls `GET /api/nodes`.

```bash
jackclaw nodes
jackclaw nodes --json
```

### `jackclaw config [key] [value]`
View or modify configuration.

```bash
jackclaw config                          # show all
jackclaw config reportSchedule           # read one
jackclaw config reportSchedule "0 9 * * *"   # set one
jackclaw config visibility full
```

**Editable keys:** `name`, `role`, `hubUrl`, `reportSchedule`, `visibility`

## Config file

`~/.jackclaw/config.json`

```json
{
  "nodeId": "node-a1b2c3d4e5f6g7h8",
  "name": "my-macbook",
  "role": "node",
  "hubUrl": "https://hub.example.com",
  "reportSchedule": "0 8 * * *",
  "visibility": "summary_only"
}
```

## Tech Stack

TypeScript · commander · chalk · axios · inquirer
