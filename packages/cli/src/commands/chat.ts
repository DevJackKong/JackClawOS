/**
 * jackclaw chat [--to <nodeId>] [--type human|task] [--hub http://localhost:3100]
 *
 * - Connects to Hub WebSocket: ws://host/chat/ws?nodeId=cli-user
 * - Pulls offline inbox via GET /api/chat/inbox on startup
 * - readline interactive terminal
 * - Display: [HH:mm] <from>: <content>
 * - /task → task mode, /human → human mode, /quit → exit
 */
import { Command } from 'commander';
import * as readline from 'readline';
import axios from 'axios';
import chalk from 'chalk';
import { randomUUID } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');

function hhmm(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function printMsg(from: string, content: string, ts?: number): void {
  const time   = chalk.gray(`[${hhmm(ts)}]`);
  const sender = chalk.cyan(from);
  console.log(`${time} ${sender}: ${content}`);
}

export function registerChat(program: Command): void {
  program
    .command('chat')
    .description('Open interactive ClawChat session via Hub WebSocket')
    .argument('[args...]', 'Optional: @handle message (one-shot send) or "to @handle" (set default)')
    .option('--to <nodeId>', 'Default recipient node ID')
    .option('--type <type>', 'Message type: human|task', 'human')
    .option('--hub <url>', 'Hub base URL', 'http://localhost:3100')
    .option('--node-id <id>', 'Your node ID in the chat', 'cli-user')
    .action(async (args: string[], opts: { to?: string; type: string; hub: string; nodeId: string }) => {
      const hubUrl = opts.hub.replace(/\/$/, '');
      const myId   = opts.nodeId;

      // ── @syntax: jackclaw chat @alice 你好 → one-shot send ─────────────────
      if (args.length > 0 && args[0].startsWith('@')) {
        const toHandle = args[0].slice(1);
        const content  = args.slice(1).join(' ');
        if (!content) {
          console.error(chalk.red('[chat] 请提供消息内容。用法：jackclaw chat @handle 消息'));
          process.exit(1);
        }
        try {
          const res = await axios.post(`${hubUrl}/api/chat/send`, {
            id: randomUUID(), from: myId, to: toHandle,
            content, timestamp: Date.now(), type: opts.type,
          }, { timeout: 8000 });
          const msgId: string = (res.data as { messageId?: string }).messageId ?? '—';
          console.log(chalk.green(`✅ 消息已发送给 @${toHandle}  messageId: ${msgId}`));
        } catch (err) {
          console.error(chalk.red(`❌ 发送失败：${(err as Error).message}`));
          process.exit(1);
        }
        return;
      }

      // ── to @bob: jackclaw chat to @bob → start interactive with default ────
      if (args.length > 0 && args[0].toLowerCase() === 'to') {
        const handleArg = args[1] ?? '';
        if (!handleArg.startsWith('@')) {
          console.error(chalk.red('[chat] 用法：jackclaw chat to @handle'));
          process.exit(1);
        }
        opts.to = handleArg.slice(1);
        console.log(chalk.yellow(`[chat] 默认聊天对象：@${opts.to}`));
        // fall through to start interactive session
      }

      let msgType = opts.type === 'task' ? 'task' : 'human';
      const wsUrl = hubUrl.replace(/^http/, 'ws') + `/chat/ws?nodeId=${encodeURIComponent(myId)}`;

      console.log(chalk.gray(`Hub: ${hubUrl}  |  node: ${myId}`));
      console.log(chalk.gray('/task = task mode  /human = human mode  /quit = exit'));
      console.log(chalk.gray('─'.repeat(50)));

      // ── Inbox pull ──────────────────────────────────────────────────────────
      try {
        const res = await axios.get(`${hubUrl}/api/chat/inbox`, {
          params: { nodeId: myId }, timeout: 5000,
        });
        const msgs: Array<{ from: string; content: string; ts?: number }> = res.data?.messages ?? [];
        if (msgs.length > 0) {
          console.log(chalk.yellow(`[inbox] ${msgs.length} offline message(s):`));
          msgs.forEach(m => printMsg(m.from, m.content, m.ts));
          console.log(chalk.gray('─'.repeat(50)));
        }
      } catch { /* non-fatal — hub may need auth or be unavailable */ }

      // ── WebSocket ───────────────────────────────────────────────────────────
      const ws = new WebSocket(wsUrl);

      ws.on('error', (err: Error) => {
        console.error(chalk.red(`[chat] WS error: ${err.message}`));
      });

      ws.on('close', () => {
        console.log(chalk.yellow('\n[chat] Disconnected.'));
        process.exit(0);
      });

      ws.on('message', (raw: Buffer | string) => {
        try {
          const envelope = JSON.parse(raw.toString());
          if (envelope.event === 'message') {
            const m = envelope.data;
            // Clear current prompt line before printing
            if (process.stdout.isTTY) { process.stdout.clearLine(0); process.stdout.cursorTo(0); }
            printMsg(m.from, m.content, m.ts);
            rl.prompt(true);
          } else if (envelope.event === 'inbox') {
            const msgs: Array<{ from: string; content: string; ts?: number }> = envelope.data ?? [];
            if (msgs.length > 0) {
              if (process.stdout.isTTY) { process.stdout.clearLine(0); process.stdout.cursorTo(0); }
              console.log(chalk.yellow(`[inbox] ${msgs.length} message(s) while offline:`));
              msgs.forEach(m => printMsg(m.from, m.content, m.ts));
              rl.prompt(true);
            }
          }
        } catch { /* ignore malformed frames */ }
      });

      // ── readline ────────────────────────────────────────────────────────────
      const rl = readline.createInterface({
        input: process.stdin, output: process.stdout, terminal: true,
      });

      ws.on('open', () => {
        console.log(chalk.green('[chat] Connected. Start typing.\n'));
        if (opts.to) console.log(chalk.gray(`[chat] Sending to: ${opts.to}`));
        rl.setPrompt(chalk.bold('> '));
        rl.prompt();
      });

      rl.on('line', (line: string) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        if (input === '/quit' || input === '/exit') { rl.close(); ws.close(); return; }

        if (input === '/task') {
          msgType = 'task';
          console.log(chalk.yellow('[chat] task mode'));
          rl.prompt(); return;
        }
        if (input === '/human') {
          msgType = 'human';
          console.log(chalk.yellow('[chat] human mode'));
          rl.prompt(); return;
        }

        // /to @handle — switch default recipient within session
        const toMatch = input.match(/^\/to\s+@(\S+)$/);
        if (toMatch) {
          opts.to = toMatch[1];
          console.log(chalk.yellow(`[chat] 默认聊天对象切换为 @${opts.to}`));
          rl.prompt(); return;
        }

        const to = opts.to ?? 'hub';
        const msg = {
          id: randomUUID(),
          from: myId,
          to,
          type: msgType,
          content: input,
          ts: Date.now(),
          signature: '',
          encrypted: false,
        };

        if (ws.readyState === 1 /* OPEN */) {
          ws.send(JSON.stringify(msg));
          const time = chalk.gray(`[${hhmm()}]`);
          console.log(`${time} ${chalk.bold('you')}: ${input}`);
        } else {
          console.error(chalk.red('[chat] Not connected'));
        }
        rl.prompt();
      });

      rl.on('close', () => { ws.close(); process.exit(0); });
    });
}

// backward-compat alias
export { registerChat as registerChatCommand };
