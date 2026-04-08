import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { execFileSync } from 'child_process';
import { getHubClientContext } from '../hub-client';

interface AuditResponse {
  success?: boolean;
  message?: string;
}

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Show Hub logs via /api/audit, fallback to railway logs')
    .option('--json', 'Output raw JSON')
    .option('--railway', 'Force railway logs fallback')
    .action(async (opts: { json?: boolean; railway?: boolean }) => {
      const { hubUrl, headers } = getHubClientContext();

      if (!opts.railway) {
        try {
          const res = await axios.get<AuditResponse>(`${hubUrl}/api/audit`, {
            headers,
            timeout: 5000,
          });

          if (opts.json) {
            console.log(JSON.stringify(res.data, null, 2));
            return;
          }

          console.log('');
          console.log(chalk.bold('Hub Audit'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log(res.data.message ?? 'Audit endpoint reachable');
          console.log('');
          return;
        } catch {
          // fallback below
        }
      }

      try {
        execFileSync('railway', ['logs'], { stdio: 'inherit' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`✗ Failed to load logs: ${message}`));
        process.exit(1);
      }
    });
}
