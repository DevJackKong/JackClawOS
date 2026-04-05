#!/usr/bin/env node
/**
 * scripts/publish.js — Publish all public packages to npm
 *
 * Usage:
 *   node scripts/publish.js           # dry run
 *   node scripts/publish.js --live    # actually publish
 *   node scripts/publish.js --tag beta # publish with beta tag
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const LIVE = process.argv.includes('--live')
const TAG  = process.argv.find(a => a.startsWith('--tag='))?.split('=')[1] ?? 'latest'

const PUBLISHABLE = [
  'protocol',
  'memory',
  'node',
  'llm-gateway',
  'jackclaw-sdk',
  'harness',
  'hub',
  'tunnel',
  'watchdog',
  'payment-vault',
  'openclaw-plugin',
  'cli',
  'create-jackclaw',
]

function run(cmd, cwd) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}

console.log(`\n🦞 JackClaw Publish Script`)
console.log(`   Mode: ${LIVE ? '🚀 LIVE' : '🧪 DRY RUN'}`)
console.log(`   Tag:  ${TAG}\n`)

// Build first
console.log('📦 Building all packages...')
run('npm run build', process.cwd())
console.log('✅ Build complete\n')

for (const pkg of PUBLISHABLE) {
  const pkgDir = path.join(process.cwd(), 'packages', pkg)
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))

  if (pkgJson.private) {
    console.log(`⏭  Skipping ${pkgJson.name} (private)`)
    continue
  }

  console.log(`📤 Publishing ${pkgJson.name}@${pkgJson.version}...`)

  const cmd = LIVE
    ? `npm publish --access public --tag ${TAG}`
    : `npm publish --access public --tag ${TAG} --dry-run`

  try {
    run(cmd, pkgDir)
    console.log(`✅ ${pkgJson.name} published\n`)
  } catch (e) {
    console.error(`❌ ${pkgJson.name} failed: ${e.message}\n`)
  }
}

console.log('🦞 Done!')
if (!LIVE) {
  console.log('\nRun with --live to actually publish to npm.')
}
