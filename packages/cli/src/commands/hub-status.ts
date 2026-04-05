import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { loadConfig, loadState } from '../config-utils';

export function registerHubStatus(program: Command): void {
  program
    .command('hub-status')
    .description('Show detailed Hub health, uptime, connections and memory')
    .option('--url <url>', 'Hub URL (overrides config)')
    .action(async (opts: { url?: string }) => {
      const config = loadConfig();
      const state = loadState();

      const hubUrl = opts.url ?? config?.hubUrl;

      if (!hubUrl) {
        console.error(chalk.red('✗ No Hub URL. Pass --url <hub-url> or run: jackclaw invite <hub-url>'));
        process.exit(1);
      }

      console.log('');
      console.log(chalk.bold('Hub Status'));
      console.log(chalk.gray('─'.repeat(44)));
      console.log(`  ${chalk.bold('Hub URL')}   ${chalk.cyan(hubUrl)}`);
      console.log('');

      // ── Basic health ────────────────────────────────────────────────────────
      let basic: Record<string, unknown> | null = null;
      try {
        const res = await axios.get(`${hubUrl}/health`, { timeout: 5000 });
        basic = res.data as Record<string, unknown>;
      } catch {
        console.log(`  ${chalk.bold('Status')}    ${chalk.red('● offline — could not reach /health')}`);
        console.log('');
        process.exit(1);
      }

      const statusColor = basic.status === 'ok' ? chalk.green : chalk.yellow;
      console.log(chalk.bold('Basic'));
      console.log(chalk.gray('─'.repeat(44)));
      console.log(`  ${chalk.bold('Status')}    ${statusColor(String(basic.status))}`);
      console.log(`  ${chalk.bold('Version')}   ${basic.version ?? 'n/a'}`);
      console.log(`  ${chalk.bold('Uptime')}    ${formatUptime(Number(basic.uptime ?? 0))}`);
      console.log('');

      // ── Detailed health ─────────────────────────────────────────────────────
      let detailed: Record<string, unknown> | null = null;
      try {
        const res = await axios.get(`${hubUrl}/health/detailed`, { timeout: 5000 });
        detailed = res.data as Record<string, unknown>;
      } catch {
        console.log(chalk.yellow('  ⚠ /health/detailed not available'));
        console.log('');
        return;
      }

      const chat = detailed.chat as Record<string, unknown>;
      const store = detailed.store as Record<string, unknown>;
      const queue = detailed.offlineQueue as Record<string, unknown>;
      const mem = detailed.memory as Record<string, unknown>;
      const sys = detailed.system as Record<string, unknown>;

      console.log(chalk.bold('Connections'));
      console.log(chalk.gray('─'.repeat(44)));
      console.log(`  ${chalk.bold('WS Connections')}    ${chalk.cyan(String(chat.connections ?? 0))}`);
      console.log(`  ${chalk.bold('Queue Depth')}       ${chat.queueDepth}`);
      console.log(`  ${chalk.bold('Overflow Active')}   ${chat.overflowActive ? chalk.yellow('yes') : chalk.green('no')}`);
      console.log(`  ${chalk.bold('Total Received')}    ${chat.totalReceived}`);
      console.log(`  ${chalk.bold('Total Delivered')}   ${chat.totalDelivered}`);
      console.log(`  ${chalk.bold('Avg Latency')}       ${chat.avgLatencyMs} ms`);
      console.log('');

      console.log(chalk.bold('Store'));
      console.log(chalk.gray('─'.repeat(44)));
      console.log(`  ${chalk.bold('Messages')}          ${store.totalMessages}`);
      console.log(`  ${chalk.bold('Threads')}           ${store.totalThreads}`);
      console.log(`  ${chalk.bold('Offline Pending')}   ${queue.totalPending}`);
      console.log('');

      console.log(chalk.bold('Memory (MB)'));
      console.log(chalk.gray('─'.repeat(44)));
      console.log(`  ${chalk.bold('RSS')}               ${mem.rss} MB`);
      console.log(`  ${chalk.bold('Heap Used')}         ${mem.heapUsed} MB`);
      console.log(`  ${chalk.bold('Heap Total')}        ${mem.heapTotal} MB`);
      console.log(`  ${chalk.bold('External')}          ${mem.external} MB`);
      console.log('');

      console.log(chalk.bold('System'));
      console.log(chalk.gray('─'.repeat(44)));
      console.log(`  ${chalk.bold('Platform')}          ${sys.platform} / ${sys.arch}`);
      console.log(`  ${chalk.bold('Node')}              ${sys.nodeVersion}`);
      console.log(`  ${chalk.bold('CPUs')}              ${sys.cpuCount}`);
      console.log(`  ${chalk.bold('Load Avg')}          ${(sys.loadAvg as number[]).map(n => n.toFixed(2)).join(' / ')}`);
      console.log(`  ${chalk.bold('Free / Total Mem')}  ${sys.freeMem} MB / ${sys.totalMem} MB`);
      console.log('');
    });
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
