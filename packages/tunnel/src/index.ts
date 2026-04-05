/**
 * index.ts — Public exports for @jackclaw/tunnel
 */

export { CloudflareTunnel, readPersistedTunnel } from './cloudflare.js';
export type { CloudflareTunnelOptions } from './cloudflare.js';

export { SelfHostedTunnel, startSelfHosted } from './selfhosted.js';
export type { SelfHostedOptions, SelfHostedResult } from './selfhosted.js';

export { WsTunnel, startWsTunnel } from './ws-tunnel.js';
export type { WsTunnelOptions, TunnelMsg, TunnelRequestMsg, TunnelResponseMsg, TunnelReadyMsg } from './ws-tunnel.js';

export { TunnelManager, tunnelManager } from './manager.js';
export type { TunnelMode, TunnelManagerOptions } from './manager.js';
