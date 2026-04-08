# @jackclaw/cli

JackClaw CLI management tool — manage Hub deployment, logs, status, nodes, and configuration.

## Install

```bash
npm install -g @jackclaw/cli
# or from monorepo root:
npm run build --workspace=packages/cli
```

## Ops Commands

### `jackclaw deploy`
Deploy Hub to Railway. Checks Railway CLI, then runs `railway up`.

```bash
jackclaw deploy
jackclaw deploy --cwd /path/to/repo
```

### `jackclaw logs`
View Hub logs. Tries `GET /api/audit` first, falls back to `railway logs`.

```bash
jackclaw logs
jackclaw logs --json
jackclaw logs --railway
```

### `jackclaw status`
Show Hub status via `/health` and `/health/detailed`.

```bash
jackclaw status
jackclaw status --json
```

### `jackclaw nodes`
List all connected nodes via `GET /api/nodes`.

```bash
jackclaw nodes
jackclaw nodes --json
```

### `jackclaw config [key] [value]`
View or modify config such as `hubUrl` and `apiKey`.

```bash
jackclaw config
jackclaw config hubUrl
jackclaw config hubUrl https://hub.jackclaw.ai
jackclaw config apiKey sk-xxx
```

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

API key/token is stored in:

`~/.jackclaw/state.json`

## Tech Stack

TypeScript · commander · chalk · axios · inquirer
