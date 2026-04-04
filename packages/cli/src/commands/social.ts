/**
 * jackclaw social — Agent 社交通信命令
 *
 * jackclaw social send <handle> <message>  — 发消息
 * jackclaw social contacts                 — 联系人列表
 * jackclaw social inbox                    — 收件箱
 * jackclaw social reply <msgId> <message>  — 回复消息
 * jackclaw social profile [--set]          — 查看/设置名片
 */

import { Command } from 'commander'
import axios from 'axios'
import chalk from 'chalk'
import * as readline from 'readline'
import { loadConfig } from '../config-utils'

function getHub(opts: { hub?: string; [k: string]: unknown }): string {
  const cfg = loadConfig()
  return (opts.hub ?? cfg?.hubUrl ?? 'http://localhost:3100').replace(/\/$/, '')
}

function getHandle(opts: { handle?: string; from?: string; [k: string]: unknown }): string {
  const cfg = loadConfig()
  return opts.handle ?? opts.from ?? (cfg as any)?.agentHandle ?? (cfg as any)?.handle ?? ''
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function registerSocial(program: Command): void {
  const social = program
    .command('social')
    .description('Agent social communication — human-to-human via agents')

  // ── send ────────────────────────────────────────────────────────────────────

  social
    .command('send <handle> <message>')
    .description('Send a social message to another agent')
    .option('--hub <url>', 'Hub base URL')
    .option('--from <handle>', 'Your agent handle')
    .option('--human <humanId>', 'Your human ID', 'cli-user')
    .option('--type <type>', 'Message type: text|request|introduction|business', 'text')
    .action(async (toAgent: string, message: string, opts: {
      hub?: string; from?: string; human: string; type: string
    }) => {
      const hub = getHub(opts)
      const fromAgent = getHandle(opts)

      if (!fromAgent) {
        console.error(chalk.red('[social] --from <handle> required (or set agentHandle in config)'))
        process.exit(1)
      }

      try {
        const res = await axios.post(`${hub}/api/social/send`, {
          fromHuman: opts.human,
          fromAgent,
          toAgent: toAgent.startsWith('@') ? toAgent : `@${toAgent}`,
          content: message,
          type: opts.type,
        })
        console.log(chalk.green(`[social] Sent ✓ messageId=${res.data.messageId}`))
      } catch (err: any) {
        const msg = err.response?.data?.message ?? err.response?.data?.error ?? err.message
        console.error(chalk.red(`[social] Send failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── contacts ────────────────────────────────────────────────────────────────

  social
    .command('contacts')
    .description('List your contacts')
    .option('--hub <url>', 'Hub base URL')
    .option('--handle <handle>', 'Your agent handle')
    .action(async (opts: { hub?: string; handle?: string }) => {
      const hub = getHub(opts)
      const handle = getHandle(opts)
      if (!handle) {
        console.error(chalk.red('[social] --handle required'))
        process.exit(1)
      }

      try {
        const res = await axios.get(`${hub}/api/social/contacts`, { params: { agentHandle: handle } })
        const contacts: Array<{ handle: string; profile: { ownerName?: string; bio?: string } | null }> = res.data.contacts
        if (contacts.length === 0) {
          console.log(chalk.gray('[social] No contacts yet.'))
          return
        }
        console.log(chalk.bold(`[social] ${handle} contacts (${contacts.length}):`))
        for (const c of contacts) {
          const name = c.profile?.ownerName ? ` — ${c.profile.ownerName}` : ''
          const bio  = c.profile?.bio       ? ` (${c.profile.bio.slice(0, 50)})` : ''
          console.log(`  ${chalk.cyan(c.handle)}${name}${chalk.gray(bio)}`)
        }
      } catch (err: any) {
        console.error(chalk.red(`[social] Failed: ${err.message}`))
        process.exit(1)
      }
    })

  // ── inbox ───────────────────────────────────────────────────────────────────

  social
    .command('inbox')
    .description('View your social inbox')
    .option('--hub <url>', 'Hub base URL')
    .option('--handle <handle>', 'Your agent handle')
    .option('--limit <n>', 'Number of messages', '20')
    .option('--offset <n>', 'Offset', '0')
    .action(async (opts: { hub?: string; handle?: string; limit: string; offset: string }) => {
      const hub = getHub(opts)
      const handle = getHandle(opts)
      if (!handle) {
        console.error(chalk.red('[social] --handle required'))
        process.exit(1)
      }

      try {
        const res = await axios.get(`${hub}/api/social/messages`, {
          params: { agentHandle: handle, limit: opts.limit, offset: opts.offset },
        })
        const msgs: Array<{ id: string; fromAgent: string; content: string; type: string; ts: number }> = res.data.messages
        if (msgs.length === 0) {
          console.log(chalk.gray('[social] Inbox empty.'))
          return
        }
        console.log(chalk.bold(`[social] Inbox for ${handle} (${res.data.total} total):`))
        for (const m of msgs) {
          const time = chalk.gray(`[${formatTs(m.ts)}]`)
          const from = chalk.cyan(m.fromAgent)
          const type = m.type !== 'text' ? chalk.yellow(` [${m.type}]`) : ''
          const id   = chalk.gray(` (id:${m.id.slice(0, 8)})`)
          console.log(`${time} ${from}${type}: ${m.content}${id}`)
        }
      } catch (err: any) {
        console.error(chalk.red(`[social] Failed: ${err.message}`))
        process.exit(1)
      }
    })

  // ── reply ───────────────────────────────────────────────────────────────────

  social
    .command('reply <msgId> <message>')
    .description('Reply to a social message')
    .option('--hub <url>', 'Hub base URL')
    .option('--from <handle>', 'Your agent handle')
    .option('--human <humanId>', 'Your human ID', 'cli-user')
    .action(async (msgId: string, message: string, opts: { hub?: string; from?: string; human: string }) => {
      const hub = getHub(opts)
      const fromAgent = getHandle(opts)
      if (!fromAgent) {
        console.error(chalk.red('[social] --from <handle> required'))
        process.exit(1)
      }

      try {
        const res = await axios.post(`${hub}/api/social/reply`, {
          replyToId: msgId,
          fromHuman: opts.human,
          fromAgent,
          content: message,
        })
        console.log(chalk.green(`[social] Reply sent ✓ messageId=${res.data.messageId}`))
      } catch (err: any) {
        const msg = err.response?.data?.error ?? err.message
        console.error(chalk.red(`[social] Reply failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── profile ─────────────────────────────────────────────────────────────────

  social
    .command('profile')
    .description('View or set your social profile (business card)')
    .option('--hub <url>', 'Hub base URL')
    .option('--handle <handle>', 'Your agent handle')
    .option('--set', 'Interactive profile setup')
    .option('--name <name>', 'Owner name')
    .option('--title <title>', 'Owner title')
    .option('--bio <bio>', 'Bio')
    .option('--skills <skills>', 'Comma-separated skills')
    .option('--policy <policy>', 'Contact policy: open|request|closed', 'request')
    .action(async (opts: {
      hub?: string; handle?: string; set?: boolean
      name?: string; title?: string; bio?: string; skills?: string; policy: string
    }) => {
      const hub = getHub(opts)
      const handle = getHandle(opts)
      if (!handle) {
        console.error(chalk.red('[social] --handle required'))
        process.exit(1)
      }

      if (opts.set || opts.name || opts.title || opts.bio || opts.skills) {
        // Set mode
        let name = opts.name, title = opts.title, bio = opts.bio, skills = opts.skills

        if (opts.set && process.stdin.isTTY) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
          const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r))
          name  = await ask(`Owner name (${handle}): `)
          title = await ask('Title / role: ')
          bio   = await ask('Bio (one line): ')
          skills = await ask('Skills (comma-separated): ')
          rl.close()
        }

        try {
          const res = await axios.post(`${hub}/api/social/profile`, {
            agentHandle: handle,
            ownerName:   name  ?? '',
            ownerTitle:  title ?? '',
            bio:         bio   ?? '',
            skills:      (skills ?? '').split(',').map(s => s.trim()).filter(Boolean),
            contactPolicy: opts.policy,
          })
          console.log(chalk.green('[social] Profile updated ✓'))
          console.log(JSON.stringify(res.data.profile, null, 2))
        } catch (err: any) {
          console.error(chalk.red(`[social] Profile update failed: ${err.message}`))
          process.exit(1)
        }
      } else {
        // View mode
        try {
          const res = await axios.get(`${hub}/api/social/profile/${encodeURIComponent(handle)}`)
          const p = res.data.profile
          console.log(chalk.bold(`\n[social] Profile: ${p.agentHandle}`))
          console.log(`  Name:   ${p.ownerName}`)
          console.log(`  Title:  ${p.ownerTitle}`)
          console.log(`  Bio:    ${p.bio}`)
          console.log(`  Skills: ${p.skills?.join(', ')}`)
          console.log(`  Policy: ${p.contactPolicy}`)
          console.log(`  Hub:    ${p.hubUrl}`)
        } catch (err: any) {
          const status = err.response?.status
          if (status === 404) {
            console.log(chalk.yellow(`[social] No profile found for ${handle}. Use --set to create one.`))
          } else {
            console.error(chalk.red(`[social] Failed: ${err.message}`))
            process.exit(1)
          }
        }
      }
    })

  // ── contact request ─────────────────────────────────────────────────────────

  social
    .command('request <toHandle>')
    .description('Send a contact request to another agent')
    .option('--hub <url>', 'Hub base URL')
    .option('--from <handle>', 'Your agent handle')
    .option('--message <msg>', 'Greeting message', 'Hi, I\'d like to connect.')
    .option('--purpose <p>', 'Purpose of contact', '建立业务联系')
    .action(async (toHandle: string, opts: { hub?: string; from?: string; message: string; purpose: string }) => {
      const hub = getHub(opts)
      const fromAgent = getHandle(opts)
      if (!fromAgent) {
        console.error(chalk.red('[social] --from required'))
        process.exit(1)
      }

      try {
        const res = await axios.post(`${hub}/api/social/contact`, {
          fromAgent,
          toAgent: toHandle.startsWith('@') ? toHandle : `@${toHandle}`,
          message: opts.message,
          purpose: opts.purpose,
        })
        console.log(chalk.green(`[social] Contact request sent ✓ requestId=${res.data.requestId}`))
      } catch (err: any) {
        const msg = err.response?.data?.message ?? err.response?.data?.error ?? err.message
        console.error(chalk.red(`[social] Request failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── threads ─────────────────────────────────────────────────────────────────

  social
    .command('threads')
    .description('List conversation threads')
    .option('--hub <url>', 'Hub base URL')
    .option('--handle <handle>', 'Your agent handle')
    .action(async (opts: { hub?: string; handle?: string }) => {
      const hub = getHub(opts)
      const handle = getHandle(opts)
      if (!handle) {
        console.error(chalk.red('[social] --handle required'))
        process.exit(1)
      }

      try {
        const res = await axios.get(`${hub}/api/social/threads`, { params: { agentHandle: handle } })
        const threads: Array<{ id: string; participants: string[]; lastMessage?: string; lastMessageAt: number; messageCount: number }> = res.data.threads
        if (threads.length === 0) {
          console.log(chalk.gray('[social] No threads yet.'))
          return
        }
        console.log(chalk.bold(`[social] Threads for ${handle} (${threads.length}):`))
        for (const t of threads) {
          const others = t.participants.filter(p => p !== handle).join(', ')
          const time = chalk.gray(formatTs(t.lastMessageAt))
          const preview = t.lastMessage ? chalk.gray(` — "${t.lastMessage.slice(0, 50)}"`) : ''
          console.log(`  ${chalk.cyan(others)} ${time} [${t.messageCount} msgs]${preview}`)
        }
      } catch (err: any) {
        console.error(chalk.red(`[social] Failed: ${err.message}`))
        process.exit(1)
      }
    })
}
