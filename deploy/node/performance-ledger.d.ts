/**
 * PerformanceLedger — 任务绩效记录 + 自动调优
 *
 * 记录每个任务的执行情况（耗时、重试次数、审批结果），
 * 每周汇总统计并自动建议 AutoRetry 策略调整。
 */
import type { RetryConfig } from './auto-retry';
export interface PerformanceRecord {
    taskId: string;
    action: string;
    attempts: number;
    approved: boolean | null;
    durationMs: number;
    timestamp: number;
}
export interface WeeklyStats {
    totalTasks: number;
    completionRate: number;
    approvalRate: number;
    avgAttempts: number;
    avgDurationMs: number;
    recommendation: string;
}
export declare class PerformanceLedger {
    private records;
    record(r: PerformanceRecord): void;
    /** 返回最近 7 天的记录 */
    private recentRecords;
    weeklyStats(): WeeklyStats;
    /**
     * 根据本周统计自动建议 RetryConfig 调整值。
     * 返回建议的 Partial<RetryConfig>，调用方可自行决定是否应用。
     */
    autoTuneRetry(): Partial<RetryConfig>;
    private _generateRecommendation;
}
export declare function getPerformanceLedger(): PerformanceLedger;
//# sourceMappingURL=performance-ledger.d.ts.map