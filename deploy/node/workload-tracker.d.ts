export interface WorkloadSnapshot {
    nodeId: string;
    activeTasks: number;
    queuedTasks: number;
    completedToday: number;
    avgResponseTimeMs: number;
    cpuPct?: number;
    memMb?: number;
    updatedAt: number;
}
export declare class WorkloadTracker {
    private nodeId;
    private snapshot;
    constructor(nodeId: string);
    increment(field: "activeTasks" | "queuedTasks"): void;
    decrement(field: "activeTasks" | "queuedTasks"): void;
    recordCompletion(durationMs: number): void;
    getSnapshot(): WorkloadSnapshot;
}
//# sourceMappingURL=workload-tracker.d.ts.map