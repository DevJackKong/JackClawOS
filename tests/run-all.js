#!/usr/bin/env node
/**
 * JackClaw Unified Test Runner
 *
 * Runs all E2E test suites sequentially, each with its own isolated Hub instance.
 * Aggregates pass/fail counts and exits with code 0 (all pass) or 1 (any failure).
 *
 * Usage:
 *   node tests/run-all.js
 *
 * Environment:
 *   VERBOSE=1   — show extra error details
 *   SKIP_E2E=1  — skip the legacy e2e.js suite (faster CI for auth/social only)
 */
'use strict'

const { spawn }  = require('child_process')
const path       = require('path')

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT    = path.join(__dirname, '..')
const TIMEOUT = 3 * 60 * 1000  // 3 minutes per suite

const suites = [
  { name: 'Core E2E',   file: 'tests/e2e.js' },
  { name: 'Auth E2E',   file: 'tests/e2e-auth.js' },
  { name: 'Social E2E', file: 'tests/e2e-social.js' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'

function banner(text) {
  const line = '─'.repeat(60)
  console.log(`\n${BOLD}${CYAN}${line}${RESET}`)
  console.log(`${BOLD}${CYAN}  ${text}${RESET}`)
  console.log(`${BOLD}${CYAN}${line}${RESET}`)
}

/**
 * Run a single test file as a child process.
 * Returns { exitCode, passed, failed } parsed from stdout.
 */
function runSuite(suiteName, filePath) {
  return new Promise((resolve) => {
    console.log(`\n${BOLD}▶ Running: ${suiteName}${RESET}`)
    console.log(`  File: ${filePath}`)
    console.log()

    let passed = 0
    let failed = 0
    let timedOut = false

    const child = spawn(process.execPath, [path.join(ROOT, filePath)], {
      cwd: ROOT,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        VERBOSE: process.env.VERBOSE ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Stream stdout directly with indentation
    child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n')
      for (const line of lines) {
        if (line.trim()) process.stdout.write(`  ${line}\n`)
      }
    })

    child.stderr.on('data', (chunk) => {
      const lines = chunk.toString().split('\n')
      for (const line of lines) {
        if (line.trim() && !line.includes('ExperimentalWarning')) {
          process.stderr.write(`  ${YELLOW}[stderr]${RESET} ${line}\n`)
        }
      }
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      console.log(`\n  ${RED}⏱ Suite timed out after ${TIMEOUT / 1000}s${RESET}`)
    }, TIMEOUT)

    child.on('close', (code) => {
      clearTimeout(timer)
      const exitCode = timedOut ? 1 : (code ?? 1)

      // Parse final summary line: "📊 XYZ Tests: N passed, M failed"
      // We rely on exit code 0 = all passed, 1 = some failed
      // Map to conceptual pass/fail for summary
      if (exitCode === 0) {
        passed = 1
        failed = 0
      } else {
        passed = 0
        failed = 1
      }

      resolve({ exitCode, passed, failed, timedOut })
    })
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  banner('JackClaw E2E Test Runner')
  console.log(`  Running ${suites.length} test suite(s)`)
  console.log(`  Node: ${process.version}`)
  console.log(`  Cwd:  ${ROOT}`)

  const results = []

  for (const suite of suites) {
    if (process.env.SKIP_E2E === '1' && suite.file === 'tests/e2e.js') {
      console.log(`\n${YELLOW}⏭  Skipping: ${suite.name} (SKIP_E2E=1)${RESET}`)
      results.push({ name: suite.name, exitCode: 0, skipped: true })
      continue
    }

    const result = await runSuite(suite.name, suite.file)
    results.push({ name: suite.name, ...result })

    if (result.exitCode !== 0) {
      console.log(`\n  ${RED}✗ ${suite.name} FAILED (exit ${result.exitCode})${RESET}`)
    } else {
      console.log(`\n  ${GREEN}✓ ${suite.name} PASSED${RESET}`)
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  banner('Test Summary')

  let totalPassed = 0
  let totalFailed = 0

  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${YELLOW}⏭  ${r.name}${RESET} — skipped`)
      continue
    }
    if (r.exitCode === 0) {
      console.log(`  ${GREEN}✅ ${r.name}${RESET}`)
      totalPassed++
    } else {
      const reason = r.timedOut ? ' (timed out)' : ''
      console.log(`  ${RED}❌ ${r.name}${reason}${RESET}`)
      totalFailed++
    }
  }

  console.log()
  console.log(`  Suites passed: ${GREEN}${totalPassed}${RESET}`)
  console.log(`  Suites failed: ${totalFailed > 0 ? RED : GREEN}${totalFailed}${RESET}`)
  console.log(`  Total time:    ${elapsed}s`)
  console.log()

  if (totalFailed > 0) {
    console.log(`${RED}${BOLD}✗ FAILED — ${totalFailed} suite(s) had errors${RESET}`)
    process.exit(1)
  } else {
    console.log(`${GREEN}${BOLD}✓ ALL SUITES PASSED${RESET}`)
    process.exit(0)
  }
}

main().catch(err => {
  console.error(`\n${RED}Fatal runner error:${RESET}`, err.message)
  process.exit(1)
})
