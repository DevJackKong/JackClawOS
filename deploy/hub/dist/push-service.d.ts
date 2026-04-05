/**
 * Web Push Notification Service (RFC 8030 / RFC 8291 / RFC 8292)
 *
 * Implements VAPID authentication and AES-128-GCM payload encryption
 * using only Node.js built-in modules (no web-push library dependency).
 */
export interface WebPushSubscription {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
        p256dh: string;
        auth: string;
    };
}
export interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    icon?: string;
    badge?: string;
    tag?: string;
}
export declare class PushService {
    private readonly vapidFile;
    private readonly subscriptionsFile;
    private vapidKeys;
    private subscriptions;
    constructor(hubDir: string);
    private loadVapidKeys;
    private generateVapidKeys;
    /** Return the VAPID application server public key for frontend use */
    getVapidPublicKey(): string;
    private loadSubscriptions;
    private saveSubscriptions;
    subscribe(nodeId: string, subscription: WebPushSubscription): void;
    unsubscribe(nodeId: string): void;
    push(nodeId: string, payload: PushPayload): Promise<boolean>;
    pushToAll(payload: PushPayload): Promise<void>;
    subscriptionCount(): number;
}
export declare const pushService: PushService;
//# sourceMappingURL=push-service.d.ts.map