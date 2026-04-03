/**
 * jackclaw demo
 *
 * One-command showcase: starts Hub + 3 Nodes, runs a simulated work day.
 * Shows registration, task dispatch, reporting, and collaboration.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import net from 'net';

const DEMO_HUB_PORT = 3100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function request(method: string, urlPath: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, `http://localhost:${DEMO_HUB_PORT}`);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, headers, timeout: 5000 };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode!, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => { s.close(); resolve(false); });
    s.listen(port, '127.0.0.1');
  });
}

function log(emoji: string, msg: string) {
  console.log(`  ${emoji}  ${msg}`);
}

export function registerDemo(program: Command): void {
  program
    .command('demo')
    .description('Run a live demo: Hub + 3 AI employees collaborate')
    .action(async () => {
      console.log(chalk.bold(`
╔═══════════════════════════════════════════════════╗
║  🦞  JackClaw Demo — Your AI Company in Action   ║
╚═══════════════════════════════════════════════════╝
`));

      // Check port
      if (await isPortInUse(DEMO_HUB_PORT)) {
        console.log(chalk.red(`  Port ${DEMO_HUB_PORT} is in use. Stop existing Hub first.`));
        process.exit(1);
      }

      // Start Hub
      log('🏢', chalk.blue('Starting Hub (HQ)...'));
      const mono = path.resolve(__dirname, '../../../../');
      const hubScript = path.join(mono, 'packages/hub/dist/index.js');
      const hubProc = spawn('node', [hubScript], {
        env: { ...process.env, HUB_PORT: String(DEMO_HUB_PORT) },
        stdio: 'pipe',
      });
      const procs: ChildProcess[] = [hubProc];

      // Wait for Hub
      for (let i = 0; i < 30; i++) {
        await sleep(300);
        try {
          const r = await request('GET', '/health');
          if (r.status === 200) break;
        } catch {}
      }
      log('✅', chalk.green(`Hub ready — http://localhost:${DEMO_HUB_PORT}`));

      // ── Act 1: CEO Registration ───────────────────────────────────
      console.log(chalk.bold('\n📋 Act 1: CEO Takes the Stage'));
      await sleep(500);

      const ceo = await request('POST', '/api/register', {
        nodeId: 'ceo-jack',
        name: '🧑‍💼 CEO Jack',
        role: 'ceo',
        publicKey: 'demo-key-ceo',
      });
      log('👔', `CEO registered — token received`);
      const ceoToken = ceo.body?.token;

      // ── Act 2: Employees Report for Duty ──────────────────────────
      console.log(chalk.bold('\n👥 Act 2: Employees Report for Duty'));
      await sleep(500);

      const employees = [
        { id: 'alice', name: '👩‍💻 Engineer Alice', role: 'engineer' },
        { id: 'bob', name: '🎨 Designer Bob', role: 'designer' },
        { id: 'carol', name: '📊 Analyst Carol', role: 'analyst' },
      ];

      const tokens: Record<string, string> = {};
      for (const emp of employees) {
        const r = await request('POST', '/api/register', {
          nodeId: emp.id,
          name: emp.name,
          role: emp.role,
          publicKey: `demo-key-${emp.id}`,
        });
        tokens[emp.id] = r.body?.token;
        log('🤝', `${emp.name} joined the team`);
        await sleep(300);
      }

      // ── Act 3: Team Status ────────────────────────────────────────
      console.log(chalk.bold('\n📡 Act 3: CEO Checks the Team'));
      await sleep(500);

      const nodesRes = await request('GET', '/api/nodes', null, ceoToken);
      const nodes = nodesRes.body?.nodes || [];
      log('📊', `${nodes.length} nodes online:`);
      for (const n of nodes) {
        const icon = n.role === 'ceo' ? '👔' : n.role === 'engineer' ? '💻' : n.role === 'designer' ? '🎨' : '📊';
        console.log(`       ${icon} ${n.name} (${n.role})`);
      }

      // ── Act 4: Daily Reports ──────────────────────────────────────
      console.log(chalk.bold('\n📝 Act 4: Daily Reports'));
      await sleep(500);

      const reports = [
        { from: 'alice', summary: 'Completed login page (3h). Auth API 50% done. No blockers.' },
        { from: 'bob', summary: 'Designed dashboard mockup (2h). Waiting for Alice\'s API.' },
        { from: 'carol', summary: 'Analyzed user metrics. Conversion up 15%. Report attached.' },
      ];

      for (const r of reports) {
        await request('POST', '/api/report', {
          summary: r.summary,
          period: 'daily',
          visibility: 'ceo',
        }, tokens[r.from]);
        const emp = employees.find(e => e.id === r.from)!;
        log('📄', `${emp.name}: "${r.summary.slice(0, 60)}..."`);
        await sleep(400);
      }

      // ── Act 5: Team Chat ──────────────────────────────────────────
      console.log(chalk.bold('\n💬 Act 5: Team Chat'));
      await sleep(500);

      const messages = [
        { from: 'alice', to: 'bob', content: 'Hey Bob, the login API is ready. You can connect the UI now.' },
        { from: 'bob', to: 'alice', content: 'Great! I\'ll start integrating tomorrow morning.' },
        { from: 'carol', to: 'ceo-jack', content: 'CEO, the Q1 report is ready. Should I share with the team?' },
      ];

      for (const m of messages) {
        await request('POST', '/api/chat/send', {
          id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: m.from,
          to: m.to,
          content: m.content,
          type: 'human',
          ts: Date.now(),
          signature: '',
          encrypted: false,
        }, tokens[m.from] || ceoToken);
        const fromName = m.from === 'ceo-jack' ? '👔 CEO' : employees.find(e => e.id === m.from)?.name || m.from;
        const toName = m.to === 'ceo-jack' ? '👔 CEO' : employees.find(e => e.id === m.to)?.name || m.to;
        log('💬', `${fromName} → ${toName}: "${m.content.slice(0, 55)}..."`);
        await sleep(300);
      }

      // ── Act 6: Daily Summary ──────────────────────────────────────
      console.log(chalk.bold('\n📋 Act 6: CEO Reviews Daily Summary'));
      await sleep(500);

      const today = new Date().toISOString().slice(0, 10);
      const summary = await request('GET', `/api/summary?date=${today}`, null, ceoToken);
      log('📊', `Date: ${summary.body?.date}`);
      log('📊', `Reporting: ${summary.body?.reportingNodes}/${summary.body?.totalNodes} nodes`);

      const byRole = summary.body?.byRole || {};
      for (const [role, data] of Object.entries(byRole) as [string, any][]) {
        for (const node of data.nodes || []) {
          console.log(`       [${role}] ${node.name}: ${node.summary?.slice(0, 50)}...`);
        }
      }

      // ── Finale ────────────────────────────────────────────────────
      console.log(chalk.bold(`
╔═══════════════════════════════════════════════════╗
║  ✅ Demo Complete!                                ║
║                                                   ║
║  Your AI company just ran a full work day:        ║
║  • 1 CEO + 3 AI employees registered              ║
║  • 3 daily reports submitted                      ║
║  • 3 cross-team messages exchanged                ║
║  • Daily summary aggregated by role               ║
║                                                   ║
║  👉 Try it yourself:                              ║
║     npx jackclaw start                            ║
║     npx jackclaw chat --to alice                  ║
║                                                   ║
║  📖 Full guide: QUICKSTART.md                     ║
║  🦞 https://github.com/DevJackKong/JackClawOS    ║
╚═══════════════════════════════════════════════════╝
`));

      // Cleanup
      hubProc.kill('SIGTERM');
      setTimeout(() => process.exit(0), 500);
    });
}
