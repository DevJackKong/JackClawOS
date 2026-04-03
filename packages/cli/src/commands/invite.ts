import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import {
  loadConfig, saveConfig, loadKeys, loadState, saveState,
} from '../config-utils';

export function registerInvite(program: Command): void {
  program
    .command('invite <hub-url>')
    .description('Register this node with a Hub')
    .action(async (hubUrl: string) => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('✗ Not initialized. Run: jackclaw init'));
        process.exit(1);
      }
      const keys = loadKeys();
      if (!keys) {
        console.error(chalk.red('✗ Keys missing. Run: jackclaw init'));
        process.exit(1);
      }

      // Normalize URL
      const base = hubUrl.replace(/\/$/, '');

      console.log(chalk.gray(`Connecting to ${base} ...`));

      try {
        const res = await axios.post(`${base}/api/nodes/register`, {
          nodeId: config.nodeId,
          name: config.name,
          role: config.role,
          publicKey: keys.publicKey,
          visibility: config.visibility,
        }, { timeout: 10000 });

        const { token, hubPublicKey } = res.data as { token: string; hubPublicKey?: string };

        // Persist token and hub info
        const state = loadState();
        saveState({ ...state, token, hubPublicKey: hubPublicKey ?? '' });

        // Update config with hubUrl
        saveConfig({ ...config, hubUrl: base });

        console.log('');
        console.log(chalk.green('✓ Registered with Hub'));
        console.log('');
        console.log(`  ${chalk.bold('Hub URL')}  ${chalk.cyan(base)}`);
        console.log(`  ${chalk.bold('Token')}    ${chalk.yellow(token.substring(0, 16) + '...')}`);
        if (hubPublicKey) {
          const hubFp = hubPublicKey.substring(0, 40).replace(/\n/g, '').trim();
          console.log(`  ${chalk.bold('Hub Key')}  ${chalk.gray(hubFp + '...')}`);
        }
        console.log('');
        console.log(chalk.gray('Connection successful. Run: jackclaw status'));
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || String(err);
        console.error(chalk.red(`✗ Registration failed: ${msg}`));
        process.exit(1);
      }
    });
}
