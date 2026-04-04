import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from '../config-utils.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHANNELS_FILE = path.join(os.homedir(), '.jackclaw', 'node', 'channels.json');
const CHANNELS_DIR  = path.dirname(CHANNELS_FILE);

const nodeUrl = (): string =>
  process.env.NODE_URL || `http://localhost:${process.env.NODE_PORT || 19000}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelConfig {
  [key: string]: string;
}

interface ChannelsFile {
  handleMappings: Record<string, string>;
  channelConfigs: Record<string, ChannelConfig>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mask sensitive string values for display. Shows first 4 + *** + last 4 chars. */
function maskValue(v: string): string {
  if (!v || v.length <= 8) return '***';
  return v.slice(0, 4) + '***' + v.slice(-4);
}

/** Read channels.json, returning a default structure if absent or unreadable. */
function readChannels(): ChannelsFile {
  if (!fs.existsSync(CHANNELS_FILE)) {
    return { handleMappings: {}, channelConfigs: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8')) as ChannelsFile;
  } catch {
    return { handleMappings: {}, channelConfigs: {} };
  }
}

/** Persist channels.json, creating parent directories as needed. */
function writeChannels(data: ChannelsFile): void {
  if (!fs.existsSync(CHANNELS_DIR)) {
    fs.mkdirSync(CHANNELS_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** Pad / truncate a string to a fixed column width. */
function padR(s: string, len: number): string {
  return s.padEnd(len).substring(0, len);
}

// Sensitive key names whose values should always be masked in output.
const SENSITIVE_KEYS = new Set(['token', 'secret', 'appSecret', 'corpSecret']);

/** Format a channel config record for display, masking sensitive values. */
function formatConfig(cfg: ChannelConfig): string {
  return Object.entries(cfg)
    .map(([k, v]) => `${k}=${SENSITIVE_KEYS.has(k) ? maskValue(v) : v}`)
    .join('  ');
}

// ─── Register ────────────────────────────────────────────────────────────────

export function registerChannel(program: Command): void {
  const channel = program
    .command('channel')
    .description('Manage IM channel connections');

  // ── channel list ───────────────────────────────────────────────────────────
  channel
    .command('list')
    .description('List all configured IM channels')
    .action(() => {
      const data = readChannels();
      const entries = Object.entries(data.channelConfigs ?? {});

      console.log('');
      console.log(chalk.bold('Configured Channels'));
      console.log(chalk.gray('─'.repeat(72)));

      if (entries.length === 0) {
        console.log(chalk.gray('  No channels configured.'));
        console.log('');
        return;
      }

      console.log(
        chalk.bold(padR('CHANNEL', 16)) +
        chalk.bold('CONFIG'),
      );
      console.log(chalk.gray('─'.repeat(72)));

      for (const [name, cfg] of entries) {
        console.log(
          chalk.cyan(padR(name, 16)) +
          chalk.gray(formatConfig(cfg)),
        );
      }

      console.log('');
      console.log(chalk.gray(`Total: ${entries.length} channel(s)`));
      console.log('');
    });

  // ── channel add ───────────────────────────────────────────────────────────
  const add = channel
    .command('add')
    .description('Add or update an IM channel configuration');

  // telegram
  add
    .command('telegram')
    .description('Add Telegram Bot channel')
    .requiredOption('--token <bot_token>', 'Telegram Bot API token')
    .action((opts: { token: string }) => {
      saveChannelConfig('telegram', { token: opts.token });
    });

  // feishu / lark
  add
    .command('feishu')
    .description('Add Feishu/Lark channel')
    .requiredOption('--app-id <id>', 'Feishu App ID')
    .requiredOption('--app-secret <secret>', 'Feishu App Secret')
    .action((opts: { appId: string; appSecret: string }) => {
      saveChannelConfig('feishu', { appId: opts.appId, appSecret: opts.appSecret });
    });

  // wechat work
  add
    .command('wechat')
    .description('Add WeChat Work channel')
    .requiredOption('--corp-id <id>', 'WeChat Corp ID')
    .requiredOption('--corp-secret <secret>', 'WeChat Corp Secret')
    .requiredOption('--agent-id <id>', 'WeChat Agent ID')
    .action((opts: { corpId: string; corpSecret: string; agentId: string }) => {
      saveChannelConfig('wechat', {
        corpId:     opts.corpId,
        corpSecret: opts.corpSecret,
        agentId:    opts.agentId,
      });
    });

  // whatsapp business
  add
    .command('whatsapp')
    .description('Add WhatsApp Business channel')
    .requiredOption('--phone-id <id>', 'WhatsApp Phone Number ID')
    .requiredOption('--token <token>', 'WhatsApp Cloud API access token')
    .action((opts: { phoneId: string; token: string }) => {
      saveChannelConfig('whatsapp', { phoneId: opts.phoneId, token: opts.token });
    });

  // discord
  add
    .command('discord')
    .description('Add Discord Bot channel')
    .requiredOption('--token <token>', 'Discord Bot token')
    .action((opts: { token: string }) => {
      saveChannelConfig('discord', { token: opts.token });
    });

  // ── channel remove ────────────────────────────────────────────────────────
  channel
    .command('remove <name>')
    .description('Remove a configured channel')
    .action((name: string) => {
      const data = readChannels();
      if (!data.channelConfigs[name]) {
        console.error(chalk.red(`✗ Channel "${name}" not found.`));
        process.exit(1);
      }
      delete data.channelConfigs[name];
      writeChannels(data);
      console.log(chalk.green(`✓ Channel "${name}" removed.`));
    });

  // ── channel status ─────────────────────────────────────────────────────────
  channel
    .command('status')
    .description('Show online/offline status for each configured channel')
    .action(async () => {
      const url = `${nodeUrl()}/api/channels/status`;

      try {
        const res = await axios.get<Record<string, string>>(url, { timeout: 5000 });
        const statusMap = res.data ?? {};

        console.log('');
        console.log(chalk.bold('Channel Status'));
        console.log(chalk.gray('─'.repeat(72)));

        const entries = Object.entries(statusMap);
        if (entries.length === 0) {
          console.log(chalk.gray('  No channels reported by node.'));
          console.log('');
          return;
        }

        console.log(
          chalk.bold(padR('CHANNEL', 16)) +
          chalk.bold('STATUS'),
        );
        console.log(chalk.gray('─'.repeat(72)));

        for (const [name, status] of entries) {
          const isConnected = /^connected$/i.test(status);
          const coloredStatus = isConnected
            ? chalk.green(status)
            : chalk.red(status);
          console.log(chalk.cyan(padR(name, 16)) + coloredStatus);
        }
        console.log('');
      } catch {
        // Node not reachable — fall back to saved configs.
        console.log(chalk.yellow('⚠ Node offline, reading saved configs'));
        console.log('');

        const data = readChannels();
        const entries = Object.entries(data.channelConfigs ?? {});

        if (entries.length === 0) {
          console.log(chalk.gray('  No channels configured.'));
          console.log('');
          return;
        }

        console.log(
          chalk.bold(padR('CHANNEL', 16)) +
          chalk.bold('STATUS'),
        );
        console.log(chalk.gray('─'.repeat(72)));

        for (const [name] of entries) {
          console.log(chalk.cyan(padR(name, 16)) + chalk.gray('unknown (node offline)'));
        }
        console.log('');
      }
    });

  // ── channel test ──────────────────────────────────────────────────────────
  channel
    .command('test <name>')
    .description('Send a test message through the named channel via the local node')
    .action(async (name: string) => {
      const url = `${nodeUrl()}/api/channels/test`;
      try {
        const res = await axios.post<{ message?: string }>(
          url,
          { name },
          { timeout: 15000 },
        );
        const msg = res.data?.message ?? 'Test message sent.';
        console.log(chalk.green(`✓ [${name}] ${msg}`));
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          String(err);
        console.error(chalk.red(`✗ [${name}] Test failed: ${msg}`));
        process.exit(1);
      }
    });
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Write a single channel config entry and print a confirmation. */
function saveChannelConfig(name: string, cfg: ChannelConfig): void {
  const data = readChannels();
  const isUpdate = Boolean(data.channelConfigs[name]);
  data.channelConfigs[name] = cfg;
  writeChannels(data);

  const verb = isUpdate ? 'updated' : 'added';
  console.log(chalk.green(`✓ Channel "${name}" ${verb}.`));
  console.log(chalk.gray(`  Config: ${formatConfig(cfg)}`));
}
