import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, JackClawConfig } from '../config-utils';

const EDITABLE_KEYS: (keyof JackClawConfig)[] = [
  'name', 'role', 'hubUrl', 'reportSchedule', 'visibility',
];

export function registerConfig(program: Command): void {
  program
    .command('config [key] [value]')
    .description('View or modify configuration')
    .action((key?: string, value?: string) => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('✗ Not initialized. Run: jackclaw init'));
        process.exit(1);
      }

      // No args → show all
      if (!key) {
        console.log('');
        console.log(chalk.bold('Current Configuration'));
        console.log(chalk.gray('─'.repeat(40)));
        for (const [k, v] of Object.entries(config)) {
          const label = chalk.bold(k.padEnd(20));
          console.log(`  ${label} ${chalk.cyan(String(v ?? ''))}`);
        }
        console.log('');
        return;
      }

      // Read-only sentinel
      if (key === 'nodeId') {
        if (!value) {
          console.log(`${chalk.bold('nodeId')}  ${chalk.cyan(config.nodeId)}`);
        } else {
          console.error(chalk.red('✗ nodeId is read-only'));
          process.exit(1);
        }
        return;
      }

      // Unknown key
      if (!EDITABLE_KEYS.includes(key as keyof JackClawConfig)) {
        console.error(chalk.red(`✗ Unknown config key: ${key}`));
        console.log(chalk.gray(`Valid keys: ${EDITABLE_KEYS.join(', ')}`));
        process.exit(1);
      }

      // Get single value
      if (!value) {
        const current = config[key as keyof JackClawConfig];
        console.log(`${chalk.bold(key)}  ${chalk.cyan(String(current ?? ''))}`);
        return;
      }

      // Validate role
      if (key === 'role' && !['node', 'hub'].includes(value)) {
        console.error(chalk.red(`✗ Invalid role: ${value}. Must be 'node' or 'hub'`));
        process.exit(1);
      }

      // Validate visibility
      if (key === 'visibility' && !['summary_only', 'full'].includes(value)) {
        console.error(chalk.red(`✗ Invalid visibility: ${value}. Must be 'summary_only' or 'full'`));
        process.exit(1);
      }

      const updated = { ...config, [key]: value } as JackClawConfig;
      saveConfig(updated);
      console.log(chalk.green(`✓ ${key} = ${value}`));
    });
}
