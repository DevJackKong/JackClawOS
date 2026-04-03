import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { loadConfig, loadState, saveState, computeNextCron } from '../config-utils';

interface ReportPayload {
  nodeId: string;
  name: string;
  timestamp: string;
  summary: string;
}

function buildReport(config: ReturnType<typeof loadConfig>): ReportPayload {
  return {
    nodeId: config!.nodeId,
    name: config!.name,
    timestamp: new Date().toISOString(),
    summary: `Node ${config!.name} (${config!.nodeId}) check-in at ${new Date().toISOString()}`,
  };
}

export function registerReport(program: Command): void {
  program
    .command('report')
    .description('Send a report to Hub')
    .option('--now', 'Send immediately (bypass schedule)')
    .option('--dry-run', 'Preview report without sending')
    .action(async (opts) => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('✗ Not initialized. Run: jackclaw init'));
        process.exit(1);
      }
      const state = loadState();

      if (!config.hubUrl || !state.token) {
        console.error(chalk.red('✗ Not connected to Hub. Run: jackclaw invite <hub-url>'));
        process.exit(1);
      }

      const payload = buildReport(config);

      if (opts.dryRun) {
        console.log('');
        console.log(chalk.bold('Report Preview (dry run)'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(JSON.stringify(payload, null, 2));
        console.log('');
        return;
      }

      console.log(chalk.gray('Sending report to Hub...'));

      try {
        await axios.post(`${config.hubUrl}/api/reports`, payload, {
          headers: { Authorization: `Bearer ${state.token}` },
          timeout: 10000,
        });

        const now = new Date().toISOString();
        const next = computeNextCron(config.reportSchedule).toISOString();
        saveState({ ...state, lastReportTime: now, nextReportTime: next });

        console.log(chalk.green('✓ Report sent'));
        console.log(`  ${chalk.bold('Time')}  ${now}`);
        console.log(`  ${chalk.bold('Next')}  ${next}`);
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || String(err);
        console.error(chalk.red(`✗ Failed to send report: ${msg}`));
        process.exit(1);
      }
    });
}
