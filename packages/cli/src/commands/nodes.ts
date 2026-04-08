import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { getHubClientContext } from '../hub-client';

interface HubNodeRecord {
  nodeId: string;
  name: string;
  role: string;
  registeredAt?: string;
  lastReportAt?: string | null;
  health?: {
    status?: string;
    lastHeartbeat?: number;
    memUsage?: number;
    cpuLoad?: number;
    uptime?: number;
    tasksCompleted?: number;
  } | null;
  workload?: {
    activeTasks?: number;
    queuedTasks?: number;
    completedToday?: number;
  } | null;
}

interface NodesResponse {
  success: boolean;
  total: number;
  nodes: HubNodeRecord[];
}

export function registerNodes(program: Command): void {
  program
    .command('nodes')
    .description('List all connected nodes from Hub /api/nodes')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      const { hubUrl, headers } = getHubClientContext({ requireToken: true });

      try {
        const res = await axios.get<NodesResponse>(`${hubUrl}/api/nodes`, {
          headers,
          timeout: 10000,
        });

        const payload = res.data;
        const nodes = payload.nodes ?? [];

        if (opts.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        if (nodes.length === 0) {
          console.log(chalk.gray('No connected nodes.'));
          return;
        }

        console.log('');
        console.log(chalk.bold('Connected Nodes'));
        console.log(chalk.gray('─'.repeat(110)));
        console.log(
          chalk.bold(padR('NODE ID', 22)) +
          chalk.bold(padR('NAME', 18)) +
          chalk.bold(padR('ROLE', 10)) +
          chalk.bold(padR('STATUS', 10)) +
          chalk.bold(padR('MEM', 10)) +
          chalk.bold(padR('CPU', 10)) +
          chalk.bold(padR('TASKS', 10)) +
          chalk.bold('LAST REPORT')
        );
        console.log(chalk.gray('─'.repeat(110)));

        for (const node of nodes) {
          const status = node.health?.status ?? 'unknown';
          const statusText = status === 'online' ? chalk.green(status) : status === 'offline' ? chalk.red(status) : chalk.yellow(status);
          console.log(
            chalk.cyan(padR(node.nodeId, 22)) +
            padR(node.name, 18) +
            chalk.blue(padR(node.role, 10)) +
            padR(statusText, 18) +
            chalk.cyan(padR(formatMb(node.health?.memUsage), 10)) +
            chalk.cyan(padR(formatCpu(node.health?.cpuLoad), 10)) +
            chalk.cyan(padR(String(node.health?.tasksCompleted ?? 0), 10)) +
            chalk.gray(node.lastReportAt ?? 'never')
          );
        }

        console.log('');
        console.log(chalk.gray(`Total: ${payload.total ?? nodes.length} node(s)`));
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err);
        console.error(chalk.red(`✗ Failed to fetch nodes: ${msg}`));
        process.exit(1);
      }
    });
}

function padR(s: string, len: number): string {
  return s.padEnd(len).slice(0, len);
}

function formatMb(value?: number): string {
  return typeof value === 'number' ? `${value}MB` : '-';
}

function formatCpu(value?: number): string {
  return typeof value === 'number' ? value.toFixed(2) : '-';
}
