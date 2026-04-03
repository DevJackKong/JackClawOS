# Contributing to JackClaw OS

Thanks for considering contributing! This guide helps you get started quickly.

## Prerequisites

- Node.js 20+
- npm 10+

## Local Setup

```bash
git clone https://github.com/<your-fork>/JackClawOS.git
cd JackClawOS
npm install
cp .env.example .env.local   # then edit as needed
npm run dev
```

The API runs at `http://127.0.0.1:8787` and the web UI at `http://127.0.0.1:5173`.

## Project Structure

```
apps/
  api/          Express backend (TypeScript)
  web/          React frontend (Vite + TypeScript)
packages/
  contracts/    Shared Zod schemas and types
docs/           Product & architecture docs
scripts/        Build verification scripts
tests/e2e/      Playwright end-to-end tests
```

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start API + web in watch mode |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run verify:smoke` | Build + integration smoke test |
| `npm run test:e2e` | Playwright end-to-end tests |

## PR Guidelines

We follow a **small steps, fast iterations** principle:

1. **One concern per PR.** Each PR should do exactly one thing: fix a bug, add a feature, refactor one module, or update docs.
2. **Keep PRs small.** Aim for < 200 lines changed. If your change is bigger, split it into a series of PRs.
3. **Branch naming convention:**
   - `fix/short-description` for bug fixes
   - `feat/short-description` for new features
   - `refactor/short-description` for refactoring
   - `docs/short-description` for documentation
4. **Write a clear PR description** with a Summary (what changed and why) and a Test Plan (how to verify).
5. **Run checks before submitting:**
   ```bash
   npm run typecheck
   npm run verify:smoke
   ```

## Commit Messages

Use conventional-style messages:

```
fix: guard JSON.parse in RunStore against corrupt data
feat: add crypto market refresh interval setting
refactor: extract shared HTTP helpers
docs: update architecture spec for v3
```

## Code Style

- TypeScript strict mode everywhere.
- Shared types go in `packages/contracts`, not duplicated across apps.
- Use Zod for runtime validation of API boundaries.
- No unnecessary comments that just narrate what the code does.

## Reporting Issues

Open a GitHub issue with:

- What you expected
- What actually happened
- Steps to reproduce
- Node.js / npm / OS version
