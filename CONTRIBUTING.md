# Contributing to JackClawOS

Thank you for your interest in contributing! 🦞

## Quick Start

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
npm test
```

## Contributor License Agreement (CLA)

By submitting a pull request, you agree to our [CLA](./CLA.md). No separate signed document is needed — opening a PR constitutes agreement.

## How to Contribute

### Reporting Bugs
- Search [existing issues](https://github.com/DevJackKong/JackClawOS/issues) first
- Include: steps to reproduce, expected behavior, actual behavior, environment info

### Suggesting Features
- Open a [GitHub Discussion](https://github.com/DevJackKong/JackClawOS/discussions) or Issue
- Describe the use case, not just the solution

### Code Contributions

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Write code + tests
4. Ensure `npm run build` passes with zero errors
5. Ensure `npm test` passes
6. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`
7. Open a PR against `main`

### Code Style
- TypeScript strict mode
- No `any` types (use `unknown` + type guards)
- Async/await over callbacks
- Meaningful variable names

### Security Vulnerabilities
**DO NOT** open a public issue. Email security@jackclaw.ai instead. See [SECURITY.md](./SECURITY.md).

## Architecture

```
packages/
├── protocol/     # Core types + E2E encryption
├── hub/          # Central coordinator
├── node/         # Agent worker
├── memory/       # 4-layer memory system
├── cli/          # Command-line interface
├── dashboard/    # React web UI
├── llm-gateway/  # Multi-model gateway
├── pwa/          # Progressive Web App
└── ...           # See README for full list
```

## License

MIT. By contributing, you agree your code will be released under MIT.

---

*Questions? Email JackClaw@jackclaw.ai*
