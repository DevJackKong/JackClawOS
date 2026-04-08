import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { getHubClientContext, getHubHealth } from '../hub-client';

interface HealthBasic {
  status?: string;
  service?: string;
  version?: string;
  uptime?: number;
}

interface HealthDetailed {
  chat?: {
    connections?: number;
  };
  memory?: {
    rss?: number;
    heapUsed?: number;
    heapTotal?: number;
  };
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show Hub status: version, online nodes, memory usage')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      const { hubUrl } = getHubClientContext();

      try {
        const { basic, detailed } = await getHubHealth(hubUrl) as { basic: HealthBasic; detailed: HealthDetailed | null };
        const nodesRes = await axios.get(`${hubUrl}/api/nodes`, { timeout: 5000 }).catch(() => ({ data: null }));
        const nodesPayload = nodesRes.data as { total?: number; nodes?: unknown[] } | null;
        const onlineNodes = nodesPayload?.total ?? nodesPayload?.nodes?.length ?? detailed?.chat?.connections ?? 0;

        const result = {
          hubUrl,
          status: basic.status ?? 'unknown',
          service: basic.service ?? 'jackclaw-hub',
          version: basic.version ?? 'n/a',
          uptime: basic.uptime ?? 0,
          onlineNodes,
          memory: detailed?.memory ?? null,
        };

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log('');
        console.log(chalk.bold('Hub Status'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`  ${chalk.bold('Hub URL')}       ${chalk.cyan(result.hubUrl)}`);
        console.log(`  ${chalk.bold('Status')}        ${result.status === 'ok' ? chalk.green('online') : chalk.yellow(result.status)}`);
        console.log(`  ${chalk.bold('Version')}       ${chalk.cyan(result.version)}`);
        console.log(`  ${chalk.bold('Online Nodes')}  ${chalk.cyan(String(result.onlineNodes))}`);
        if (result.memory) {
          console.log(`  ${chalk.bold('Memory RSS')}    ${chalk.cyan(String(result.memory.rss ?? 'n/a'))} MB`);
          console.log(`  ${chalk.bold('Heap Used')}     ${chalk.cyan(String(result.memory.heapUsed ?? 'n/a'))} MB`);
        }
        console.log('');
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err);
        console.error(chalk.red(`✗ Failed to fetch Hub status: ${msg}`));
        process.exit(1);
      }
    });
}
