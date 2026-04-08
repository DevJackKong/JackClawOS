"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkloadTracker = void 0;
class WorkloadTracker {
    nodeId;
    snapshot;
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.snapshot = {
            nodeId,
            activeTasks: 0,
            queuedTasks: 0,
            completedToday: 0,
            avgResponseTimeMs: 0,
            updatedAt: Date.now(),
        };
    }
    increment(field) {
        this.snapshot[field]++;
        this.snapshot.updatedAt = Date.now();
    }
    decrement(field) {
        this.snapshot[field] = Math.max(0, this.snapshot[field] - 1);
        this.snapshot.updatedAt = Date.now();
    }
    recordCompletion(durationMs) {
        this.snapshot.completedToday++;
        this.snapshot.activeTasks = Math.max(0, this.snapshot.activeTasks - 1);
        this.snapshot.avgResponseTimeMs =
            (this.snapshot.avgResponseTimeMs * (this.snapshot.completedToday - 1) + durationMs) /
                this.snapshot.completedToday;
        this.snapshot.updatedAt = Date.now();
    }
    getSnapshot() {
        return { ...this.snapshot };
    }
}
exports.WorkloadTracker = WorkloadTracker;
//# sourceMappingURL=workload-tracker.js.map