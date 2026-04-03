import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  loadConfig, saveConfig, loadKeys, saveKeys,
  generateNodeId, generateKeyPair, CONFIG_FILE,
} from '../config-utils';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize node identity and create config')
    .option('--name <name>', 'Node name')
    .option('--role <role>', 'Node role: node | hub', 'node')
    .option('--no-tunnel', 'Skip tunnel setup')
    .action(async (opts) => {
      const existing = loadConfig();
      if (existing) {
        const { overwrite } = await inquirer.prompt([{
          type: 'confirm',
          name: 'overwrite',
          message: chalk.yellow(`Config already exists (${existing.nodeId}). Overwrite?`),
          default: false,
        }]);
        if (!overwrite) {
          console.log(chalk.gray('Aborted.'));
          return;
        }
      }

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Node name:',
          default: opts.name || require('os').hostname(),
          when: !opts.name,
        },
        {
          type: 'list',
          name: 'role',
          message: 'Node role:',
          choices: ['node', 'hub'],
          default: opts.role,
          when: !opts.role || opts.role === 'node',
        },
      ]);

      const name = opts.name || answers.name;
      const role = answers.role || opts.role || 'node';
      const nodeId = generateNodeId();
      const keys = generateKeyPair();

      saveKeys(keys);
      saveConfig({
        nodeId,
        name,
        role: role as 'node' | 'hub',
        reportSchedule: '0 8 * * *',
        visibility: 'summary_only',
      });

      console.log('');
      console.log(chalk.green('✓ Node initialized'));
      console.log('');
      console.log(`  ${chalk.bold('Node ID')}     ${chalk.cyan(nodeId)}`);
      console.log(`  ${chalk.bold('Name')}        ${name}`);
      console.log(`  ${chalk.bold('Role')}        ${role}`);
      console.log(`  ${chalk.bold('Fingerprint')} ${chalk.yellow(keys.fingerprint)}`);
      console.log('');
      console.log(chalk.gray(`Config saved to ${CONFIG_FILE}`));

      // ── Tunnel setup ──────────────────────────────────────────────
      if (opts.tunnel !== false) {
        await promptTunnelSetup();
      }
    });
}

async function promptTunnelSetup(): Promise<void> {
  const { enableTunnel } = await inquirer.prompt([{
    type: 'confirm',
    name: 'enableTunnel',
    message: 'Enable public tunnel? (exposes this node via a public URL)',
    default: false,
  }]);

  if (!enableTunnel) return;

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Tunnel mode:',
    choices: [
      { name: 'cloudflare  — free public URL via cloudflared (trycloudflare.com)', value: 'cloudflare' },
      { name: 'selfhosted  — self-signed HTTPS on LAN / VPN', value: 'selfhosted' },
    ],
  }]);

  const { port } = await inquirer.prompt([{
    type: 'number',
    name: 'port',
    message: 'Local HTTP port to expose:',
    default: 3000,
  }]);

  console.log('');
  console.log(chalk.cyan(`Starting ${mode} tunnel on port ${port}…`));

  try {
    // Dynamic import so the CLI doesn't hard-depend on @jackclaw/tunnel at startup
    const { TunnelManager } = await import('@jackclaw/tunnel');
    const tm = new TunnelManager({ autoRestart: true });

    const url = await tm.start(port as number, mode as 'cloudflare' | 'selfhosted');

    console.log('');
    console.log(chalk.green('✓ Tunnel active'));
    console.log(`  ${chalk.bold('Public URL')} ${chalk.cyan(url)}`);
    console.log('');
    console.log(chalk.gray('The tunnel runs as long as this process is alive.'));
    console.log(chalk.gray('Use `jackclaw tunnel start` to run it in the background.'));

    // Keep alive until Ctrl-C
    process.on('SIGINT', async () => {
      await tm.stop();
      process.exit(0);
    });
    await new Promise(() => {}); // block forever
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('');
    console.log(chalk.red('✗ Tunnel failed: ') + msg);
    console.log(chalk.gray('You can start it later with: jackclaw tunnel start --port ' + port + ' --mode ' + mode));
  }
}
