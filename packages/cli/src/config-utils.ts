import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export const CONFIG_DIR = path.join(os.homedir(), '.jackclaw');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const KEYS_FILE = path.join(CONFIG_DIR, 'keys.json');
export const STATE_FILE = path.join(CONFIG_DIR, 'state.json');

export interface JackClawConfig {
  nodeId: string;
  name: string;
  role: 'node' | 'hub';
  hubUrl?: string;
  reportSchedule: string;
  visibility: 'summary_only' | 'full';
  handle?: string;         // @handle registered on Hub
}

export interface JackClawKeys {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export interface JackClawState {
  token?: string;
  apiKey?: string;
  hubPublicKey?: string;
  lastReportTime?: string;
  nextReportTime?: string;
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export const DEFAULT_HUB_URL = 'http://localhost:3100';

/**
 * Resolve Hub URL: JACKCLAW_HUB_URL env > HUB_URL env > config file > default.
 */
export function resolveHubUrl(configHubUrl?: string): string {
  return (
    process.env.JACKCLAW_HUB_URL ||
    process.env.HUB_URL ||
    configHubUrl ||
    DEFAULT_HUB_URL
  ).replace(/\/$/, '');
}

export function loadConfig(): JackClawConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

export function saveConfig(config: JackClawConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function loadKeys(): JackClawKeys | null {
  if (!fs.existsSync(KEYS_FILE)) return null;
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
}

export function saveKeys(keys: JackClawKeys): void {
  ensureConfigDir();
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

export function loadState(): JackClawState {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

export function saveState(state: JackClawState): void {
  ensureConfigDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function generateNodeId(): string {
  return 'node-' + crypto.randomBytes(8).toString('hex');
}

export function generateKeyPair(): JackClawKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const pubKeyDer = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  const fingerprint = crypto.createHash('sha256').update(pubKeyDer).digest('hex')
    .match(/.{2}/g)!.join(':').substring(0, 47);
  return { publicKey, privateKey, fingerprint };
}

export function computeNextCron(schedule: string): Date {
  // Simple next-day 08:00 approximation for "0 8 * * *"
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(8, 0, 0, 0);
  return next;
}
