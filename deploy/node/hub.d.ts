import type { JackClawConfig } from './config';
import type { NodeIdentity } from '@jackclaw/protocol';
/**
 * Register this node with the Hub.
 * Hub endpoint: POST /api/register
 */
export declare function registerWithHub(identity: NodeIdentity, config: JackClawConfig): Promise<void>;
/**
 * Send a report message to the Hub.
 * Hub endpoint: POST /api/report
 */
export declare function sendReportToHub(nodeId: string, encryptedMessage: string, config: JackClawConfig): Promise<void>;
//# sourceMappingURL=hub.d.ts.map