/**
 * manager.ts — Unified TunnelManager
 *
 * Wraps CloudflareTunnel, SelfHostedTunnel, and WsTunnel behind a single interface.
 */

import { CloudflareTunnel } from './cloudflare.js';
import { SelfHostedTunnel } from './selfhosted.js';
import { WsTunnel } from './ws-tunnel.js';

export type TunnelMode = 'cloudflare' | 'selfhosted' | 'hub';

export interface TunnelManagerOptions {
  /** Restart cloudflared on crash (default: true) */
  autoRestart?: boolean;
  /** Hostname for self-signed cert (default: localhost) */
  selfHostedHostname?: string;
  /** Fixed HTTPS port for self-hosted mode (0 = random) */
  selfHostedPort?: number;
  /** Hub WebSocket URL for 'hub' mode, e.g. ws://hub.example.com/tunnel/ws */
  hubWsUrl?: string;
  /** Node ID for 'hub' mode */
  nodeId?: string;
  /** Auth token for 'hub' mode */
  token?: string;
  onUrl?: (url: string) => void;
}

export class TunnelManager {
  private mode: TunnelMode | null = null;
  private cfTunnel: CloudflareTunnel | null = null;
  private shTunnel: SelfHostedTunnel | null = null;
  private wsTunnel: WsTunnel | null = null;
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
    } else if (mode === 'selfhosted') {
      this.shTunnel = new SelfHostedTunnel({
        targetPort: port,
        httpsPort: this.opts.selfHostedPort ?? 0,
        hostname: this.opts.selfHostedHostname ?? 'localhost',
      });
      const url = await this.shTunnel.start();
      this.publicUrl = url;
      this.opts.onUrl?.(url);
      return url;
    } else {
      // hub mode — port is the local service port to tunnel
      if (!this.opts.hubWsUrl) throw new Error('hubWsUrl is required for hub mode');
      if (!this.opts.nodeId) throw new Error('nodeId is required for hub mode');

      this.wsTunnel = new WsTunnel({
        hubWsUrl: this.opts.hubWsUrl,
        nodeId: this.opts.nodeId,
        localPort: port,
        token: this.opts.token,
        onReady: (url) => {
          this.publicUrl = url;
          this.opts.onUrl?.(url);
        },
        onDisconnect: () => {
          this.publicUrl = null;
        },
      });
      const url = await this.wsTunnel.start();
      this.publicUrl = url;
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
    if (this.wsTunnel) {
      this.wsTunnel.stop();
      this.wsTunnel = null;
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

