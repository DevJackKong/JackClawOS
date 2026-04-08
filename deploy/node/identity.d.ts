import { NodeIdentity } from '@jackclaw/protocol';
/**
 * Load existing identity or generate + persist a new one.
 * Accepts optional overrides from config for display name and role.
 */
export declare function loadOrCreateIdentity(opts?: {
    displayName?: string;
    role?: string;
}): NodeIdentity;
//# sourceMappingURL=identity.d.ts.map