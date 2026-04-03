import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { loadConfig, loadKeys, loadState, computeNextCron } from '../config-utils';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show node status and Hub connection')
    .action(async () => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('✗ Not initialized. Run: jackclaw init'));
        process.exit(1);
      }
      const keys = loadKeys();
      const state = loadState();

      console.log('');
      console.log(chalk.bold('JackClaw Node Status'));
      console.log(chalk.gray('─'.repeat(40)));

      console.log(`  ${chalk.bold('Node ID')}          ${chalk.cyan(config.nodeId)}`);
      console.log(`  ${chalk.bold('Name')}             ${config.name}`);
      console.log(`  ${chalk.bold('Role')}             ${roleLabel(config.role)}`);
      console.log(`  ${chalk.bold('Fingerprint')}      ${chalk.yellow(keys?.fingerprint ?? 'n/a')}`);
      console.log(`  ${chalk.bold('Report Schedule')}  ${config.reportSchedule}`);
      console.log(`  ${chalk.bold('Visibility')}       ${config.visibility}`);

      console.log('');
      console.log(chalk.bold('Hub Connection'));
      console.log(chalk.gray('─'.repeat(40)));

      if (!config.hubUrl || !state.token) {
        console.log(`  ${chalk.yellow('⚠ Not connected')}  Run: jackclaw invite <hub-url>`);
      } else {
        // Ping hub
        let hubStatus = chalk.gray('checking...');
        try {
          await axios.get(`${config.hubUrl}/api/health`, { timeout: 5000 });
          hubStatus = chalk.green('● online');
        } catch {
          hubStatus = chalk.red('● offline');
        }

        console.log(`  ${chalk.bold('Hub URL')}          ${chalk.cyan(config.hubUrl)}`);
        console.log(`  ${chalk.bold('Status')}           ${hubStatus}`);
        console.log(`  ${chalk.bold('Last Report')}      ${state.lastReportTime ?? chalk.gray('never')}`);
        console.log(`  ${chalk.bold('Next Report')}      ${state.nextReportTime ?? computeNextCron(config.reportSchedule).toISOString()}`);
      }
      console.log('');
    });
}

function roleLabel(role: string): string {
  if (role === 'hub') return chalk.magenta('hub');
  return chalk.blue('node');
}
