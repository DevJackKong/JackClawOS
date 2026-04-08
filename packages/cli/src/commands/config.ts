import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, JackClawConfig, loadState, saveState } from '../config-utils';

const EDITABLE_CONFIG_KEYS: (keyof JackClawConfig)[] = [
  'name', 'role', 'hubUrl', 'reportSchedule', 'visibility',
];

const EDITABLE_STATE_KEYS = ['apiKey'] as const;
type EditableStateKey = typeof EDITABLE_STATE_KEYS[number];

export function registerConfig(program: Command): void {
  program
    .command('config [key] [value]')
    .description('View or modify Hub configuration such as hubUrl and apiKey')
    .addHelpText('after', `
Examples:
  jackclaw config
  jackclaw config hubUrl
  jackclaw config hubUrl https://hub.jackclaw.ai
  jackclaw config apiKey sk-xxx
`)
    .action((key?: string, value?: string) => {
      const config = loadConfig();
      const state = loadState();

      if (!config) {
        console.error(chalk.red('✗ Not initialized. Run: jackclaw init'));
        process.exit(1);
      }

      if (!key) {
        console.log('');
        console.log(chalk.bold('Current Configuration'));
        console.log(chalk.gray('─'.repeat(40)));
        for (const [k, v] of Object.entries(config)) {
          const label = chalk.bold(k.padEnd(20));
          console.log(`  ${label} ${chalk.cyan(String(v ?? ''))}`);
        }
        console.log(`  ${chalk.bold('apiKey'.padEnd(20))} ${chalk.cyan(maskSecret(state.apiKey || state.token))}`);
        console.log('');
        return;
      }

      if (key === 'nodeId') {
        if (!value) {
          console.log(`${chalk.bold('nodeId')}  ${chalk.cyan(config.nodeId)}`);
        } else {
          console.error(chalk.red('✗ nodeId is read-only'));
          process.exit(1);
        }
        return;
      }

      if ((EDITABLE_STATE_KEYS as readonly string[]).includes(key)) {
        const stateKey = key as EditableStateKey;
        if (!value) {
          console.log(`${chalk.bold(stateKey)}  ${chalk.cyan(maskSecret(state[stateKey] || state.token))}`);
          return;
        }
        const nextState = { ...state, [stateKey]: value, token: value };
        saveState(nextState);
        console.log(chalk.green(`✓ ${stateKey} updated`));
        return;
      }

      if (!EDITABLE_CONFIG_KEYS.includes(key as keyof JackClawConfig)) {
        console.error(chalk.red(`✗ Unknown config key: ${key}`));
        console.log(chalk.gray(`Valid keys: ${[...EDITABLE_CONFIG_KEYS, ...EDITABLE_STATE_KEYS].join(', ')}`));
        process.exit(1);
      }

      if (!value) {
        const current = config[key as keyof JackClawConfig];
        console.log(`${chalk.bold(key)}  ${chalk.cyan(String(current ?? ''))}`);
        return;
      }

      if (key === 'role' && !['node', 'hub'].includes(value)) {
        console.error(chalk.red(`✗ Invalid role: ${value}. Must be 'node' or 'hub'`));
        process.exit(1);
      }

      if (key === 'visibility' && !['summary_only', 'full'].includes(value)) {
        console.error(chalk.red(`✗ Invalid visibility: ${value}. Must be 'summary_only' or 'full'`));
        process.exit(1);
      }

      const updated = { ...config, [key]: value } as JackClawConfig;
      saveConfig(updated);
      console.log(chalk.green(`✓ ${key} = ${value}`));
    });
}

function maskSecret(value?: string): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
