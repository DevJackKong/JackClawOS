import path from "node:path";

import { defineConfig } from "@playwright/test";

const e2eDbPath = path.resolve(".tmp", "bossassistant-e2e.sqlite");
const e2eApiUrl = "http://127.0.0.1:8795";
const e2eWebUrl = "http://127.0.0.1:4175";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: e2eWebUrl,
    headless: true
  },
  webServer: [
    {
      command: "node apps/api/dist/index.js",
      url: `${e2eApiUrl}/api/health`,
      env: {
        ...process.env,
        PORT: "8795",
        BOSSASSISTANT_DB_PATH: e2eDbPath,
        BOSSASSISTANT_ENABLE_AI: "0"
      },
      reuseExistingServer: false
    },
    {
      command: "npm run preview -w @bossassistant/web -- --host 127.0.0.1 --port 4175",
      url: e2eWebUrl,
      reuseExistingServer: false
    }
  ]
});
