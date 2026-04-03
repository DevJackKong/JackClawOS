/**
 * jackclaw mention @handle [--topic "..."] [--context "..."]
 *                          [--teaching] [--clear-memory]
 *                          [--auto-accept]
 *
 * Send a collaboration invitation to another JackClaw agent.
 * Examples:
 *   jackclaw mention @bob --topic "Code review"
 *   jackclaw mention @alice.myorg --topic "Teach me React" --teaching --clear-memory
 *   jackclaw mention @cto --topic "Architecture decision" --context "We need to migrate DB"
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig, saveConfig, loadKeys, JackClawConfig } from '../config-utils'
import { IdentityClient } from '../identity-client'

function getPublicKey(): string {
  const keys = loadKeys()
  return keys?.publicKey ?? ''
}

export function mentionCommand(program: Command): void {
  program
    .command('mention <handle>')
    .description('Send a collaboration invitation to another JackClaw agent (@handle)')
    .option('-t, --topic <topic>', 'What this collaboration is about')
    .option('-c, --context <context>', 'Optional background context to share')
    .option('--teaching', 'Mark as a teaching session (knowledge transfer)')
    .option('--clear-memory', 'Clear teaching memory when session ends')
    .option('--auto-accept', 'Auto-accept if trust level is high enough')
    .option('--shared', 'Use shared memory scope instead of isolated')
    .action(async (handle: string, opts) => {
      const config = loadConfig()
      if (!config) { console.error(chalk.red('✗ Not configured. Run: jackclaw init')); process.exit(1) }
      if (!config.hubUrl || !config.nodeId) {
        console.error(chalk.red('✗ Not configured. Run: jackclaw init'))
        process.exit(1)
      }

      const client = new IdentityClient({
        hubUrl: config.hubUrl,
        nodeId: config.nodeId,
        publicKey: getPublicKey(),
      })

      // Load our registered handle
      if (config.handle) {
        (client as any).myHandle = config.handle
      } else {
        console.error(chalk.red('✗ No handle registered. Run: jackclaw identity register @yourname'))
        process.exit(1)
      }

      // Normalize handle
      const target = handle.startsWith('@') ? handle : `@${handle}`

      // First check if target exists
      console.log(chalk.dim(`Looking up ${target}...`))
      const lookup = await client.lookup(target)
      if (!lookup.found) {
        console.error(chalk.red(`✗ Agent ${target} not found on this Hub`))
        process.exit(1)
      }

      const topic = opts.topic ?? `Collaboration with ${target}`
      const memoryScope = opts.teaching ? 'teaching' : opts.shared ? 'shared' : 'isolated'

      console.log(chalk.dim(`Sending invitation to ${chalk.bold(target)}...`))

      try {
        const result = await client.invite(target, {
          topic,
          context: opts.context,
          memoryScope,
          memoryClearOnEnd: opts.clearMemory ?? false,
          autoAccept: opts.autoAccept ?? false,
        })

        if (result.status === 'accepted') {
          console.log(chalk.green(`✓ ${target} auto-accepted!`))
          console.log(chalk.dim(`  Session: ${result.sessionId}`))
        } else {
          console.log(chalk.yellow(`⏳ Invitation sent to ${target} — waiting for response`))
          console.log(chalk.dim(`  Invite ID: ${result.inviteId}`))
          console.log(chalk.dim(`  Session: ${result.sessionId}`))
        }

        console.log()
        console.log(chalk.bold('Collaboration details:'))
        console.log(`  Topic: ${topic}`)
        console.log(`  Memory scope: ${memoryScope}`)
        if (memoryScope === 'teaching' && opts.clearMemory) {
          console.log(`  ${chalk.yellow('Teaching memory will be cleared when session ends')}`)
        }

      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`))
        process.exit(1)
      }
    })
}

// ─── Identity subcommand ───────────────────────────────────────────────────────

export function identityCommand(program: Command): void {
  const identity = program.command('identity').description('Manage your @handle identity')

  // jackclaw identity register @alice
  identity
    .command('register <handle>')
    .description('Register your @handle on the Hub')
    .option('-n, --name <name>', 'Display name')
    .option('-r, --role <role>', 'Role: ceo|executive|member|guest|bot', 'member')
    .option('--public', 'Make your agent publicly discoverable')
    .action(async (handle: string, opts) => {
      const config = loadConfig()
      if (!config.hubUrl || !config.nodeId) {
        console.error(chalk.red('✗ Not configured. Run: jackclaw init'))
        process.exit(1)
      }

      const client = new IdentityClient({
        hubUrl: config.hubUrl,
        nodeId: config.nodeId,
        publicKey: getPublicKey(),
        defaultRole: opts.role,
      })

      try {
        const profile = await client.register(handle, {
          displayName: opts.name,
          role: opts.role,
          visibility: opts.public ? 'public' : 'contacts',
        })

        console.log(chalk.green(`✓ Registered as ${chalk.bold(profile.handle)}`))
        console.log(chalk.dim(`  Display name: ${profile.displayName}`))
        console.log(chalk.dim(`  Role: ${profile.role}`))
        console.log(chalk.dim(`  Visibility: ${profile.visibility}`))

        // Save handle to config
        // saveConfig already imported
        saveConfig({ ...config, handle: profile.handle })

      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`))
        process.exit(1)
      }
    })

  // jackclaw identity lookup @alice
  identity
    .command('lookup <handle>')
    .description('Look up another agent by @handle')
    .action(async (handle: string) => {
      const config = loadConfig()
      const client = new IdentityClient({
        hubUrl: config.hubUrl ?? 'http://localhost:3100',
        nodeId: config.nodeId ?? '',
        publicKey: getPublicKey(),
      })

      const result = await client.lookup(handle)
      if (!result.found) {
        console.log(chalk.yellow(`Agent ${handle} not found`))
        return
      }

      const p = result.profile!
      console.log(chalk.bold(p.handle))
      console.log(`  Name: ${p.displayName}`)
      console.log(`  Role: ${p.role}`)
      console.log(`  Capabilities: ${p.capabilities.join(', ') || '(none listed)'}`)
      console.log(`  Hub: ${p.hubUrl}`)
      if (p.lastSeen) {
        const ago = Math.round((Date.now() - p.lastSeen) / 1000 / 60)
        console.log(`  Last seen: ${ago}m ago`)
      }
    })

  // jackclaw identity who
  identity
    .command('who')
    .description('Show agents on this Hub')
    .action(async () => {
      const config = loadConfig()
      const client = new IdentityClient({
        hubUrl: config.hubUrl ?? 'http://localhost:3100',
        nodeId: config.nodeId ?? '',
        publicKey: getPublicKey(),
      })

      const agents = await client.listPublic()
      if (agents.length === 0) {
        console.log(chalk.dim('No public agents registered on this Hub'))
        return
      }

      console.log(chalk.bold(`Agents on this Hub (${agents.length}):`))
      agents.forEach(a => {
        const online = a.lastSeen && (Date.now() - a.lastSeen) < 5 * 60 * 1000
        const dot = online ? chalk.green('●') : chalk.dim('○')
        console.log(`  ${dot} ${chalk.bold(a.handle)} — ${a.displayName} [${a.role}]`)
        if (a.capabilities.length) console.log(chalk.dim(`      capabilities: ${a.capabilities.join(', ')}`))
      })
    })
}

// ─── Sessions subcommand ───────────────────────────────────────────────────────

export function sessionsCommand(program: Command): void {
  const sessions = program.command('sessions').description('Manage collaboration sessions')

  sessions
    .command('list')
    .description('List your collaboration sessions')
    .option('-s, --status <status>', 'Filter by status: pending|accepted|paused|ended')
    .action(async (opts) => {
      const config = loadConfig()
      if (!config.handle) {
        console.error(chalk.red('✗ No handle registered'))
        process.exit(1)
      }

      const client = new IdentityClient({
        hubUrl: config.hubUrl ?? 'http://localhost:3100',
        nodeId: config.nodeId ?? '',
        publicKey: getPublicKey(),
      })
      ;(client as any).myHandle = config.handle

      const list = await client.mySessions(opts.status)
      if (list.length === 0) {
        console.log(chalk.dim('No sessions found'))
        return
      }

      list.forEach(s => {
        const statusColor: Record<string, chalk.Chalk> = {
          pending: chalk.yellow,
          accepted: chalk.green,
          paused: chalk.blue,
          ended: chalk.dim,
          declined: chalk.red,
          conditional: chalk.cyan,
        }
        const colorFn = statusColor[s.status] ?? chalk.white
        console.log(`${colorFn(`[${s.status}]`)} ${chalk.bold(s.topic)}`)
        console.log(chalk.dim(`  Session: ${s.sessionId}`))
        console.log(chalk.dim(`  Participants: ${s.participants.join(', ')}`))
        if (s.outcome) console.log(chalk.dim(`  Outcome: ${s.outcome}`))
        console.log()
      })
    })

  sessions
    .command('end <sessionId>')
    .description('End a collaboration session')
    .option('-o, --outcome <outcome>', 'Summary of what was accomplished')
    .action(async (sessionId: string, opts) => {
      const config = loadConfig()
      const client = new IdentityClient({
        hubUrl: config.hubUrl ?? 'http://localhost:3100',
        nodeId: config.nodeId ?? '',
        publicKey: getPublicKey(),
      })

      const session = await client.updateSession(sessionId, 'end', opts.outcome)
      console.log(chalk.green(`✓ Session ended`))
      if (session.memoryClearOnEnd && session.memoryScope === 'teaching') {
        console.log(chalk.yellow('  Teaching memory flagged for cleanup'))
      }
    })

  sessions
    .command('respond <inviteId> <decision>')
    .description('Respond to a collaboration invitation (accept|decline|conditional)')
    .option('-c, --conditions <conditions>', 'Conditions (if decision is conditional)')
    .option('-m, --message <message>', 'Optional message')
    .action(async (inviteId: string, decision: string, opts) => {
      const config = loadConfig()
      if (!config.handle) {
        console.error(chalk.red('✗ No handle registered'))
        process.exit(1)
      }

      const client = new IdentityClient({
        hubUrl: config.hubUrl ?? 'http://localhost:3100',
        nodeId: config.nodeId ?? '',
        publicKey: getPublicKey(),
      })
      ;(client as any).myHandle = config.handle

      if (!['accept', 'decline', 'conditional'].includes(decision)) {
        console.error(chalk.red(`✗ Invalid decision: ${decision}. Use: accept|decline|conditional`))
        process.exit(1)
      }

      const session = await client.respond(
        inviteId,
        decision as 'accept' | 'decline' | 'conditional',
        { conditions: opts.conditions, message: opts.message }
      )

      const verb = decision === 'accept' ? chalk.green('Accepted') : decision === 'decline' ? chalk.red('Declined') : chalk.cyan('Conditionally accepted')
      console.log(`${verb} invite — session: ${session.sessionId}`)
    })
}
