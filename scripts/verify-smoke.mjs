import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(rootDir, "packages/contracts/fixtures/intent-router");
const apiUrl = process.env.BOSSASSISTANT_API_URL ?? "http://127.0.0.1:8787";
const webUrl = process.env.BOSSASSISTANT_WEB_URL ?? "http://127.0.0.1:4173";
const dbPath = process.env.BOSSASSISTANT_DB_PATH ?? path.join(rootDir, ".tmp", "bossassistant-smoke.sqlite");
const shouldStartServers = process.env.BOSSASSISTANT_SKIP_SERVER_START !== "1";
const children = [];

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function log(prefix, message) {
  process.stdout.write(`[${prefix}] ${message}`);
}

function startProcess(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    log(name, chunk.toString());
  });

  child.stderr.on("data", (chunk) => {
    log(name, chunk.toString());
  });

  children.push(child);
  return child;
}

async function waitFor(check, timeoutMs, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const ready = await check();

      if (ready) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(500);
  }

  throw new Error(`Timed out while waiting for ${label}.`);
}

async function waitForJson(url, predicate, label) {
  await waitFor(async () => {
    const response = await fetch(url);

    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return predicate(payload);
  }, 30_000, label);
}

async function waitForText(url, predicate, label) {
  await waitFor(async () => {
    const response = await fetch(url);

    if (!response.ok) {
      return false;
    }

    const payload = await response.text();
    return predicate(payload);
  }, 30_000, label);
}

async function runFixtureChecks() {
  const files = (await readdir(fixtureDir)).filter((file) => file.endsWith(".json")).sort();
  const failures = [];
  const seenRunIds = [];

  for (const file of files) {
    const fixture = JSON.parse(await readFile(path.join(fixtureDir, file), "utf8"));
    const response = await fetch(`${apiUrl}/api/console/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        commandText: fixture.input.commandText,
        policyMode: fixture.input.policyMode,
        locale: fixture.input.locale,
        timezone: fixture.input.timezone
      })
    });

    if (!response.ok) {
      failures.push({
        fixture: file,
        reason: `HTTP ${response.status}`
      });
      continue;
    }

    const data = await response.json();
    const checks = {
      workflowType: data.route.workflowType === fixture.expectedRoute.workflowType,
      routeStatus: data.route.routeStatus === fixture.expectedRoute.routeStatus,
      fallbackMode: data.route.fallbackStrategy.mode === fixture.expectedRoute.fallbackMode,
      nextActionType: data.route.nextAction.type === fixture.expectedRoute.nextActionType,
      riskLevel: data.route.riskLevel === fixture.expectedRoute.riskLevel,
      urgency: data.route.urgency === fixture.expectedRoute.urgency,
      approvalExpected: data.route.approvalHint.expected === fixture.expectedRoute.approvalExpected,
      approvalStage: data.route.approvalHint.stage === fixture.expectedRoute.approvalStage,
      minimumConfidence: data.route.confidence >= fixture.expectedRoute.minimumConfidence,
      planWorkflowType: data.plan.workflowType === fixture.expectedRoute.workflowType,
      planHasSteps: Array.isArray(data.plan.steps) && data.plan.steps.length > 0
    };

    const passed = Object.values(checks).every(Boolean);
    const summary =
      `${passed ? "PASS" : "FAIL"} ${file} -> ${data.route.workflowType} / ${data.route.routeStatus} / ${data.route.confidence.toFixed(2)}\n`;
    process.stdout.write(summary);
    seenRunIds.push(data.runId);

    if (!passed) {
      failures.push({
        fixture: file,
        checks,
        actual: {
          workflowType: data.route.workflowType,
          routeStatus: data.route.routeStatus,
          fallbackMode: data.route.fallbackStrategy.mode,
          nextActionType: data.route.nextAction.type,
          riskLevel: data.route.riskLevel,
          urgency: data.route.urgency,
          approvalExpected: data.route.approvalHint.expected,
          approvalStage: data.route.approvalHint.stage,
          confidence: data.route.confidence
        }
      });
    }
  }

  if (failures.length > 0) {
    process.stdout.write(`${JSON.stringify(failures, null, 2)}\n`);
    throw new Error(`Smoke verification failed for ${failures.length} fixture(s).`);
  }

  const historyResponse = await fetch(`${apiUrl}/api/runs?limit=20`);

  if (!historyResponse.ok) {
    throw new Error(`Run history endpoint failed with HTTP ${historyResponse.status}.`);
  }

  const historyPayload = await historyResponse.json();

  if (!Array.isArray(historyPayload.runs) || historyPayload.runs.length < files.length) {
    throw new Error("Run history endpoint did not return the persisted fixture runs.");
  }

  const latestRunId = seenRunIds.at(-1);

  if (!latestRunId) {
    throw new Error("Smoke run did not produce any run ids.");
  }

  const persistedRunResponse = await fetch(`${apiUrl}/api/runs/${latestRunId}`);

  if (!persistedRunResponse.ok) {
    throw new Error(`Persisted run lookup failed with HTTP ${persistedRunResponse.status}.`);
  }

  const persistedRun = await persistedRunResponse.json();

  if (persistedRun.runId !== latestRunId) {
    throw new Error("Persisted run lookup returned an unexpected run payload.");
  }
}

async function main() {
  if (!existsSync(path.join(rootDir, "apps/api/dist/index.js"))) {
    throw new Error("Missing apps/api/dist/index.js. Run `npm run build` first.");
  }

  if (!existsSync(path.join(rootDir, "apps/web/dist/index.html"))) {
    throw new Error("Missing apps/web/dist/index.html. Run `npm run build` first.");
  }

  if (shouldStartServers) {
    await mkdir(path.dirname(dbPath), { recursive: true });
    await rm(dbPath, { force: true });

    startProcess("api", "node", ["apps/api/dist/index.js"], {
      PORT: "8787",
      BOSSASSISTANT_DB_PATH: dbPath,
      BOSSASSISTANT_ENABLE_AI: "0"
    });
    startProcess("web", getNpmCommand(), [
      "run",
      "preview",
      "-w",
      "@bossassistant/web",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      "4173"
    ]);
  }

  await waitForJson(`${apiUrl}/api/health`, (payload) => payload.ok === true, "API health");
  await waitForText(webUrl, (payload) => payload.includes("BossAssistant"), "web preview");

  process.stdout.write("Smoke environment is ready.\n");
  await runFixtureChecks();
  process.stdout.write("Smoke verification passed.\n");
}

async function shutdown() {
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) {
            resolve();
            return;
          }

          child.once("exit", () => resolve());
          child.kill("SIGTERM");
        })
    )
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await shutdown();
}
