/**
 * jackclaw start [--hub-only] [--node-only] [--hub-port 3100] [--node-port 19000]
 *
 * Spawns Hub (blue) and/or Node (green) processes.
 * - Port pre-flight: exits with error if port already in use
 * - Health poll: waits for /health → ok before printing "✅ ready"
 * - Ctrl+C: SIGTERM → 1s → SIGKILL graceful exit
 */
import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import http from 'http';
import chalk from 'chalk';
import { TunnelManager } from '@jackclaw/tunnel';

// ─── Port check ────────────────────────────────────────────────────────────────

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'));
    s.once('listening', () => { s.close(); resolve(false); });
    s.listen(port, '127.0.0.1');
  });
}

// ─── Health poll ───────────────────────────────────────────────────────────────

function waitForHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
      http.get(url, res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try { if (JSON.parse(body).status === 'ok') return resolve(); } catch {}
          setTimeout(attempt, 1000);
        });
      }).on('error', () => setTimeout(attempt, 1000));
    }
    attempt();
  });
}

// ─── Spawn with colored prefix ─────────────────────────────────────────────────

function spawnService(opts: {
  label: string;
  color: chalk.Chalk;
  script: string;
  env?: Record<string, string>;
}): ChildProcess {
  const prefix = opts.color(`[${opts.label}]`);
  const child = spawn('node', [opts.script], {
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => {
    d.toString().split('\n').filter(l => l.trim()).forEach(l => console.log(`${prefix} ${l}`));
  });
  child.stderr?.on('data', (d: Buffer) => {
    d.toString().split('\n').filter(l => l.trim()).forEach(l => console.error(`${prefix} ${chalk.red(l)}`));
  });
  child.on('exit', code => {
    if (code !== null && code !== 0) console.error(`${prefix} ${chalk.red(`exited with code ${code}`)}`);
  });
  return child;
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(procs: ChildProcess[]): void {
  console.log(chalk.yellow('\n[start] Shutting down...'));
  procs.forEach(p => { if (p.exitCode === null) p.kill('SIGTERM'); });
  setTimeout(() => {
    procs.forEach(p => { if (p.exitCode === null) p.kill('SIGKILL'); });
    process.exit(0);
  }, 1000).unref();
}

// ─── Command ───────────────────────────────────────────────────────────────────

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start JackClaw Hub and/or Node services')
    .option('--hub-only', 'Start Hub only')
    .option('--node-only', 'Start Node only')
    .option('--hub-port <port>', 'Hub HTTP port', '3100')
    .option('--node-port <port>', 'Node HTTP port', '19000')
    .option('--nodes <count>', 'Number of nodes to start', '1')
    .option('--tunnel [mode]', 'Enable tunnel: cloudflare (default) or selfhosted')
    .action(async (opts: { hubOnly?: boolean; nodeOnly?: boolean; hubPort: string; nodePort: string; nodes: string; tunnel?: string | boolean }) => {
      const startHub  = !opts.nodeOnly;
      const startNode = !opts.hubOnly;
      const nodeCount = Math.max(1, parseInt(opts.nodes, 10) || 1);
      const hubPort   = parseInt(opts.hubPort, 10);
      const nodePort  = parseInt(opts.nodePort, 10);
      const tunnelMode = opts.tunnel === true ? 'cloudflare' : (opts.tunnel as string | undefined);

      // Resolve dist entry points relative to monorepo root
      const mono = path.resolve(__dirname, '../../../../');
      const hubScript  = path.join(mono, 'packages/hub/dist/index.js');
      const nodeScript = path.join(mono, 'packages/node/dist/index.js');

      const procs: ChildProcess[] = [];

      // Port pre-flight
      if (startHub && await isPortInUse(hubPort)) {
        console.error(chalk.red(`✗ Port ${hubPort} already in use (Hub). Use --hub-port to change.`));
        process.exit(1);
      }
      if (startNode && await isPortInUse(nodePort)) {
        console.error(chalk.red(`✗ Port ${nodePort} already in use (Node). Use --node-port to change.`));
        process.exit(1);
      }

      // Spawn Hub
      if (startHub) {
        console.log(chalk.blue(`[start] Spawning Hub on port ${hubPort}...`));
        procs.push(spawnService({
          label: 'hub', color: chalk.blue, script: hubScript,
          env: { HUB_PORT: String(hubPort) },
        }));
        try {
          await waitForHealth(`http://localhost:${hubPort}/health`);
          console.log(chalk.green(`✅ Hub ready — http://localhost:${hubPort}`));
        } catch (e: any) {
          console.error(chalk.red(`✗ Hub not healthy: ${e.message}`));
          shutdown(procs); return;
        }
      }

      // Spawn Node(s)
      if (startNode) {
        const nodeColors = [chalk.green, chalk.cyan, chalk.magenta, chalk.yellow, chalk.white];
        for (let i = 0; i < nodeCount; i++) {
          const port = nodePort + i;
          const label = nodeCount > 1 ? `node-${i + 1}` : 'node';
          const color = nodeColors[i % nodeColors.length];
          
          if (await isPortInUse(port)) {
            console.error(chalk.red(`✗ Port ${port} already in use. Skipping ${label}.`));
            continue;
          }

          console.log(color(`[start] Spawning ${label} on port ${port}...`));
          procs.push(spawnService({
            label, color, script: nodeScript,
            env: { NODE_PORT: String(port), JACKCLAW_HUB_URL: `http://localhost:${hubPort}`, JACKCLAW_NODE_ID: label },
          }));
          try {
            await waitForHealth(`http://localhost:${port}/health`);
            console.log(chalk.green(`✅ ${label} ready — http://localhost:${port}`));
          } catch (e: any) {
            console.error(chalk.red(`✗ ${label} not healthy: ${e.message}`));
          }
        }
      }

      if (procs.length === 0) { console.error(chalk.red('Nothing to start.')); process.exit(1); }

      // ── Tunnel ────────────────────────────────────────────────────
      let tunnelUrl: string | null = null
      if (tunnelMode && startHub) {
        const validModes = ['cloudflare', 'selfhosted']
        const mode = validModes.includes(tunnelMode) ? tunnelMode as 'cloudflare' | 'selfhosted' : 'cloudflare'
        console.log(chalk.yellow(`[tunnel] Starting ${mode} tunnel for Hub port ${hubPort}...`))
        try {
          const tm = new TunnelManager({
            onUrl: (url) => {
              console.log(chalk.bold.yellow(`\n🌐 Public URL: ${url}`))
              console.log(chalk.gray(`   Share this with external nodes and teammates\n`))
            }
          })
          tunnelUrl = await tm.start(hubPort, mode)
          // Graceful shutdown
          const originalShutdown = shutdown
          process.on('SIGINT',  () => { tm.stop().finally(() => originalShutdown(procs)) })
          process.on('SIGTERM', () => { tm.stop().finally(() => originalShutdown(procs)) })
        } catch (e: any) {
          console.warn(chalk.yellow(`[tunnel] Failed to start tunnel: ${e.message}`))
          console.warn(chalk.gray(`   Is cloudflared installed? brew install cloudflare/cloudflare/cloudflared`))
        }
      }

      console.log(chalk.bold('\n🦞 JackClaw is running'));
      if (startHub) {
        console.log(chalk.blue(`   Hub:       http://localhost:${hubPort}`))
        console.log(chalk.blue(`   Dashboard: http://localhost:${hubPort}`))
        if (tunnelUrl) console.log(chalk.bold.yellow(`   Public:    ${tunnelUrl}`))
      }
      if (startNode) console.log(chalk.green(`   Node: http://localhost:${nodePort}`));
      console.log(chalk.gray('   Ctrl+C to stop.\n'));

      if (!tunnelMode) {
        process.on('SIGINT',  () => shutdown(procs));
        process.on('SIGTERM', () => shutdown(procs));
      }
    });
}

// backward-compat alias
export { registerStart as registerStartCommand };
