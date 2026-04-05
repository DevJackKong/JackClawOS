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
export declare function setWorkload(nodeId: string, snapshot: WorkloadSnapshot): void;
export declare function getWorkload(nodeId: string): WorkloadSnapshot | null;
export declare function getAllWorkloads(): Record<string, WorkloadSnapshot>;
//# sourceMappingURL=workload-cache.d.ts.map