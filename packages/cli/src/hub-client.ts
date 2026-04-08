import axios from 'axios';
import chalk from 'chalk';
import { loadConfig, loadState, saveConfig, saveState, resolveHubUrl, JackClawConfig, JackClawState } from './config-utils';

export interface HubClientOptions {
  requireToken?: boolean;
  allowEnvToken?: boolean;
}

export interface HubClientContext {
  config: JackClawConfig | null;
  state: JackClawState;
  hubUrl: string;
  token?: string;
  headers: Record<string, string>;
}

export function getHubClientContext(options: HubClientOptions = {}): HubClientContext {
  const config = loadConfig();
  const state = loadState();
  const hubUrl = resolveHubUrl(config?.hubUrl);
  const token = state.apiKey || state.token || (options.allowEnvToken !== false ? process.env.HUB_TOKEN : undefined);

  if (options.requireToken && !token) {
    console.error(chalk.red('✗ Hub API key/token not configured. Run: jackclaw config apiKey <token>'));
    process.exit(1);
  }

  return {
    config,
    state,
    hubUrl,
    token,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

export async function getHubHealth(hubUrl: string): Promise<any> {
  const [basicRes, detailedRes] = await Promise.all([
    axios.get(`${hubUrl}/health`, { timeout: 5000 }),
    axios.get(`${hubUrl}/health/detailed`, { timeout: 5000 }).catch(() => ({ data: null })),
  ]);

  return {
    basic: basicRes.data,
    detailed: detailedRes.data,
  };
}

export function setHubUrl(url: string): void {
  const config = loadConfig();
  if (!config) {
    console.error(chalk.red('✗ Not initialized. Run: jackclaw init'));
    process.exit(1);
  }
  saveConfig({ ...config, hubUrl: url.replace(/\/$/, '') });
}

export function setApiKey(apiKey: string): void {
  const state = loadState();
  saveState({ ...state, token: apiKey });
}
