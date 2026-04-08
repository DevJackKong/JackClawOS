export interface RegisteredNode {
    nodeId: string;
    name: string;
    role: string;
    publicKey: string;
    registeredAt: number;
    lastReportAt?: number;
    callbackUrl?: string;
}
export interface NodeRegistry {
    nodes: Record<string, RegisteredNode>;
    updatedAt: number;
}
export interface ReportEntry {
    nodeId: string;
    messageId: string;
    timestamp: number;
    summary: string;
    period: string;
    visibility: 'full' | 'summary_only' | 'private';
    data: Record<string, unknown>;
}
export interface DailyReports {
    date: string;
    nodeId: string;
    reports: ReportEntry[];
}
export interface SummaryResponse {
    date: string;
    byRole: Record<string, RoleSummary>;
    totalNodes: number;
    reportingNodes: number;
}
export interface RoleSummary {
    role: string;
    nodes: Array<{
        nodeId: string;
        name: string;
        summary: string;
        period: string;
        reportedAt: number;
    }>;
}
export interface JWTPayload {
    nodeId: string;
    role: string;
    iat?: number;
    exp?: number;
}
export interface TenantContext {
    tenantId: string;
    orgId?: string;
    workspaceId?: string;
    userId: string;
    role: string;
}
declare global {
    namespace Express {
        interface Request {
            tenantContext?: TenantContext;
        }
    }
}
//# sourceMappingURL=types.d.ts.map