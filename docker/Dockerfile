# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY packages/protocol/package*.json packages/protocol/
COPY packages/tunnel/package*.json packages/tunnel/
COPY packages/memory/package*.json packages/memory/
COPY packages/llm-gateway/package*.json packages/llm-gateway/
COPY packages/hub/package*.json packages/hub/
COPY packages/node/package*.json packages/node/
COPY packages/cli/package*.json packages/cli/
COPY packages/harness/package*.json packages/harness/
COPY packages/watchdog/package*.json packages/watchdog/

RUN npm install

COPY . .
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

EXPOSE 3100 19000

CMD ["node", "packages/cli/dist/index.js", "start"]
