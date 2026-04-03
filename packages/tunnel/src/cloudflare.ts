/**
 * cloudflare.ts — cloudflared quick-tunnel manager
 *
 * - Detects cloudflared binary; prints install hint if missing
 * - Launches `cloudflared tunnel --url http://localhost:PORT`
 * - Parses stdout/stderr for the public trycloudflare.com URL
 * - Persists URL to ~/.jackclaw/tunnel.json
 * - Auto-restarts on crash (configurable max retries)
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

export interface CloudflareTunnelOptions {
  port: number;
  /** Maximum consecutive restart attempts before giving up (default: 10) */
  maxRetries?: number;
  /** Milliseconds to wait between restarts (default: 3000) */
  retryDelayMs?: number;
  onUrl?: (url: string) => void;
  onExit?: (code: number | null) => void;
}

const JACKCLAW_DIR = join(homedir(), '.jackclaw');
const TUNNEL_FILE = join(JACKCLAW_DIR, 'tunnel.json');
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Returns path to cloudflared binary, or null if not found. */
function findCloudflared(): string | null {
  try {
    const path = execSync('which cloudflared 2>/dev/null', { encoding: 'utf8' }).trim();
    return path || null;
  } catch {
    return null;
  }
}

/** Persist public URL + metadata to ~/.jackclaw/tunnel.json */
function persistUrl(url: string, port: number): void {
  if (!existsSync(JACKCLAW_DIR)) mkdirSync(JACKCLAW_DIR, { recursive: true });
  const data = {
    url,
    port,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(TUNNEL_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Read persisted tunnel info (may be stale). */
export function readPersistedTunnel(): { url: string; port: number; updatedAt: string } | null {
  try {
    if (!existsSync(TUNNEL_FILE)) return null;
    return JSON.parse(readFileSync(TUNNEL_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export class CloudflareTunnel {
  private process: ChildProcess | null = null;
  private publicUrl: string | null = null;
  private retryCount = 0;
  private stopped = false;
  private readonly opts: Required<Omit<CloudflareTunnelOptions, 'onUrl' | 'onExit'>> &
    Pick<CloudflareTunnelOptions, 'onUrl' | 'onExit'>;

  constructor(opts: CloudflareTunnelOptions) {
    this.opts = {
      port: opts.port,
      maxRetries: opts.maxRetries ?? 10,
      retryDelayMs: opts.retryDelayMs ?? 3000,
      onUrl: opts.onUrl,
      onExit: opts.onExit,
    };
  }

  /** Start the tunnel. Throws if cloudflared is not installed. */
  async start(): Promise<string> {
    const binary = findCloudflared();
    if (!binary) {
      const msg = [
        'cloudflared is not installed.',
        '',
        'Install it with one of:',
        '  macOS:  brew install cloudflared',
        '  Linux:  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared',
        '  More:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      ].join('\n');
      throw new Error(msg);
    }

    return new Promise((resolve, reject) => {
      this.spawnProcess(binary, resolve, reject);
    });
  }

  private spawnProcess(
    binary: string,
    resolve?: (url: string) => void,
    reject?: (err: Error) => void,
  ): void {
    if (this.stopped) return;

    const args = ['tunnel', '--url', `http://localhost:${this.opts.port}`];
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      if (!this.publicUrl) {
        const match = text.match(URL_PATTERN);
        if (match) {
          this.publicUrl = match[0];
          persistUrl(this.publicUrl, this.opts.port);
          this.opts.onUrl?.(this.publicUrl);
          resolve?.(this.publicUrl);
          resolve = undefined; // fire once
        }
      }
    };

    child.stdout?.on('data', handleOutput);
    child.stderr?.on('data', handleOutput);

    child.on('error', (err) => {
      if (reject) { reject(err); reject = undefined; }
    });

    child.on('close', (code) => {
      this.process = null;
      this.opts.onExit?.(code);

      if (!this.stopped && this.retryCount < this.opts.maxRetries) {
        this.retryCount++;
        // Reset URL so next spawn can re-resolve
        this.publicUrl = null;
        setTimeout(() => this.spawnProcess(binary), this.opts.retryDelayMs);
      } else if (!this.stopped && reject) {
        reject(new Error(`cloudflared exited with code ${code} after ${this.retryCount} retries`));
      }
    });
  }

  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  stop(): void {
    this.stopped = true;
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
}
