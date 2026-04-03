import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { loadConfig, loadState } from '../config-utils';

interface NodeRecord {
  nodeId: string;
  name: string;
  role: string;
  lastSeen?: string;
  status?: string;
}

export function registerNodes(program: Command): void {
  program
    .command('nodes')
    .description('List all nodes (Hub role only)')
    .option('--json', 'Output raw JSON')
    .action(async (opts) => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('✗ Not initialized. Run: jackclaw init'));
        process.exit(1);
      }

      if (config.role !== 'hub') {
        console.error(chalk.red('✗ Only Hub nodes can list all nodes'));
        process.exit(1);
      }

      const state = loadState();
      if (!config.hubUrl || !state.token) {
        console.error(chalk.red('✗ Not connected to Hub. Run: jackclaw invite <hub-url>'));
        process.exit(1);
      }

      try {
        const res = await axios.get<NodeRecord[]>(`${config.hubUrl}/api/nodes`, {
          headers: { Authorization: `Bearer ${state.token}` },
          timeout: 10000,
        });

        const nodes = res.data;

        if (opts.json) {
          console.log(JSON.stringify(nodes, null, 2));
          return;
        }

        if (!nodes || nodes.length === 0) {
          console.log(chalk.gray('No nodes registered.'));
          return;
        }

        console.log('');
        console.log(chalk.bold('Registered Nodes'));
        console.log(chalk.gray('─'.repeat(72)));

        // Header
        console.log(
          chalk.bold(padR('NODE ID', 24)) +
          chalk.bold(padR('NAME', 20)) +
          chalk.bold(padR('ROLE', 8)) +
          chalk.bold(padR('STATUS', 10)) +
          chalk.bold('LAST SEEN')
        );
        console.log(chalk.gray('─'.repeat(72)));

        for (const n of nodes) {
          const statusColor = n.status === 'online' ? chalk.green : chalk.red;
          console.log(
            chalk.cyan(padR(n.nodeId, 24)) +
            padR(n.name, 20) +
            chalk.blue(padR(n.role, 8)) +
            statusColor(padR(n.status ?? 'unknown', 10)) +
            chalk.gray(n.lastSeen ?? 'never')
          );
        }
        console.log('');
        console.log(chalk.gray(`Total: ${nodes.length} node(s)`));
        console.log('');
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || String(err);
        console.error(chalk.red(`✗ Failed to fetch nodes: ${msg}`));
        process.exit(1);
      }
    });
}

function padR(s: string, len: number): string {
  return s.padEnd(len).substring(0, len);
}
