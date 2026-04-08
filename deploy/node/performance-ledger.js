"use strict";
/**
 * PerformanceLedger — 任务绩效记录 + 自动调优
 *
 * 记录每个任务的执行情况（耗时、重试次数、审批结果），
 * 每周汇总统计并自动建议 AutoRetry 策略调整。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceLedger = void 0;
exports.getPerformanceLedger = getPerformanceLedger;
class PerformanceLedger {
    records = [];
    record(r) {
        this.records.push(r);
    }
    /** 返回最近 7 天的记录 */
    recentRecords() {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return this.records.filter(r => r.timestamp >= cutoff);
    }
    weeklyStats() {
        const recent = this.recentRecords();
        const totalTasks = recent.length;
        if (totalTasks === 0) {
            return {
                totalTasks: 0,
                completionRate: 1,
                approvalRate: 1,
                avgAttempts: 1,
                avgDurationMs: 0,
                recommendation: '暂无数据，请持续积累任务记录。',
            };
        }
        // completionRate: attempts === 1 视为一次成功
        const succeeded = recent.filter(r => r.attempts === 1).length;
        const completionRate = succeeded / totalTasks;
        // approvalRate: 只计算已审核（approved !== null）的记录
        const reviewed = recent.filter(r => r.approved !== null);
        const approvalRate = reviewed.length > 0
            ? reviewed.filter(r => r.approved === true).length / reviewed.length
            : 1;
        const avgAttempts = recent.reduce((s, r) => s + r.attempts, 0) / totalTasks;
        const avgDurationMs = recent.reduce((s, r) => s + r.durationMs, 0) / totalTasks;
        const recommendation = this._generateRecommendation(avgAttempts, approvalRate, completionRate);
        return { totalTasks, completionRate, approvalRate, avgAttempts, avgDurationMs, recommendation };
    }
    /**
     * 根据本周统计自动建议 RetryConfig 调整值。
     * 返回建议的 Partial<RetryConfig>，调用方可自行决定是否应用。
     */
    autoTuneRetry() {
        const stats = this.weeklyStats();
        const suggestion = {};
        if (stats.avgAttempts > 2) {
            // 频繁重试 → 说明 prompt 质量差，降低 maxAttempts 避免浪费
            suggestion.maxAttempts = 2;
        }
        else if (stats.avgAttempts <= 1.2 && stats.completionRate > 0.9) {
            // 质量很好 → 可以给更多重试空间
            suggestion.maxAttempts = 4;
        }
        return suggestion;
    }
    _generateRecommendation(avgAttempts, approvalRate, completionRate) {
        const hints = [];
        if (avgAttempts > 2) {
            hints.push('平均重试次数 > 2，建议加强 context 注入（callWithNorms）或精化 prompt 模板。');
        }
        if (approvalRate < 0.7) {
            hints.push('审批通过率 < 70%，建议提高 requireHumanApproval 审核门槛，加入更多前置校验。');
        }
        if (completionRate < 0.8) {
            hints.push('一次成功率 < 80%，建议检查任务描述清晰度，适当降低单次任务复杂度。');
        }
        return hints.length > 0 ? hints.join(' ') : '本周表现良好，无需调整策略。';
    }
}
exports.PerformanceLedger = PerformanceLedger;
// Singleton per process
let _ledger = null;
function getPerformanceLedger() {
    if (!_ledger)
        _ledger = new PerformanceLedger();
    return _ledger;
}
//# sourceMappingURL=performance-ledger.js.map