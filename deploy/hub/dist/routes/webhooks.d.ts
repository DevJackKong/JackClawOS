declare const router: import("express-serve-static-core").Router;
declare const ALLOWED_EVENTS: readonly ["message", "contact_request", "contact_response"];
export type WebhookEvent = typeof ALLOWED_EVENTS[number];
export interface WebhookConfig {
    url: string;
    secret?: string;
    events: WebhookEvent[];
    enabled: boolean;
}
export declare function getWebhookConfig(handle: string): WebhookConfig | null;
export declare function queueWebhookEvent<T>(handle: string, event: WebhookEvent, data: T): void;
export default router;
//# sourceMappingURL=webhooks.d.ts.map