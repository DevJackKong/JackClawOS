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
    .action(async (opts: { hubOnly?: boolean; nodeOnly?: boolean; hubPort: string; nodePort: string }) => {
      const startHub  = !opts.nodeOnly;
      const startNode = !opts.hubOnly;
      const hubPort   = parseInt(opts.hubPort, 10);
      const nodePort  = parseInt(opts.nodePort, 10);

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

      // Spawn Node
      if (startNode) {
        console.log(chalk.green(`[start] Spawning Node on port ${nodePort}...`));
        procs.push(spawnService({
          label: 'node', color: chalk.green, script: nodeScript,
          env: { NODE_PORT: String(nodePort), JACKCLAW_HUB_URL: `http://localhost:${hubPort}` },
        }));
        try {
          await waitForHealth(`http://localhost:${nodePort}/health`);
          console.log(chalk.green(`✅ Node ready — http://localhost:${nodePort}`));
        } catch (e: any) {
          console.error(chalk.red(`✗ Node not healthy: ${e.message}`));
          shutdown(procs); return;
        }
      }

      if (procs.length === 0) { console.error(chalk.red('Nothing to start.')); process.exit(1); }

      console.log(chalk.bold('\n🦞 JackClaw is running'));
      if (startHub) console.log(chalk.blue(`   Hub:  http://localhost:${hubPort}`));
      if (startNode) console.log(chalk.green(`   Node: http://localhost:${nodePort}`));
      console.log(chalk.gray('   Ctrl+C to stop.\n'));
      process.on('SIGINT',  () => shutdown(procs));
      process.on('SIGTERM', () => shutdown(procs));
    });
}

// backward-compat alias
export { registerStart as registerStartCommand };
