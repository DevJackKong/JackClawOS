/**
 * manager.ts — Unified TunnelManager
 *
 * Wraps CloudflareTunnel and SelfHostedTunnel behind a single interface.
 */

import { CloudflareTunnel } from './cloudflare.js';
import { SelfHostedTunnel } from './selfhosted.js';

export type TunnelMode = 'cloudflare' | 'selfhosted';

export interface TunnelManagerOptions {
  /** Restart cloudflared on crash (default: true) */
  autoRestart?: boolean;
  /** Hostname for self-signed cert (default: localhost) */
  selfHostedHostname?: string;
  /** Fixed HTTPS port for self-hosted mode (0 = random) */
  selfHostedPort?: number;
  onUrl?: (url: string) => void;
}

export class TunnelManager {
  private mode: TunnelMode | null = null;
  private cfTunnel: CloudflareTunnel | null = null;
  private shTunnel: SelfHostedTunnel | null = null;
  private publicUrl: string | null = null;

  constructor(private readonly opts: TunnelManagerOptions = {}) {}

  /**
   * Start a tunnel on `port` using the given mode.
   * Returns the resolved public URL.
   */
  async start(port: number, mode: TunnelMode): Promise<string> {
    if (this.publicUrl) {
      throw new Error('TunnelManager is already running. Call stop() first.');
    }

    this.mode = mode;

    if (mode === 'cloudflare') {
      this.cfTunnel = new CloudflareTunnel({
        port,
        maxRetries: this.opts.autoRestart !== false ? 10 : 0,
        onUrl: (url) => {
          this.publicUrl = url;
          this.opts.onUrl?.(url);
        },
      });
      const url = await this.cfTunnel.start();
      this.publicUrl = url;
      return url;
    } else {
      this.shTunnel = new SelfHostedTunnel({
        targetPort: port,
        httpsPort: this.opts.selfHostedPort ?? 0,
        hostname: this.opts.selfHostedHostname ?? 'localhost',
      });
      const url = await this.shTunnel.start();
      this.publicUrl = url;
      this.opts.onUrl?.(url);
      return url;
    }
  }

  /** Returns the current public URL, or null if not started. */
  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  /** Stop the active tunnel. */
  async stop(): Promise<void> {
    if (this.cfTunnel) {
      this.cfTunnel.stop();
      this.cfTunnel = null;
    }
    if (this.shTunnel) {
      await this.shTunnel.stop();
      this.shTunnel = null;
    }
    this.publicUrl = null;
    this.mode = null;
  }

  isRunning(): boolean {
    return this.publicUrl !== null;
  }

  getMode(): TunnelMode | null {
    return this.mode;
  }
}

/** Singleton for use across the CLI / node packages */
export const tunnelManager = new TunnelManager();
