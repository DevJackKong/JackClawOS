/**
 * OwnerMemory — Agent 主人记忆区
 *
 * 设计原则：
 * 1. 与 WorkMemory 完全隔离 — 工作调用不读此区，情感模块不读工作区
 * 2. 被动积累 — 从日常对话中静默提取，不打扰主人
 * 3. 未来情感模块的数据源 — 结构化存储，随时可接入
 * 4. 主人不可见（默认） — Agent 的私人观察，提升自然度
 */
export type OwnerMemoryType = 'personality' | 'relationship' | 'emotional-state' | 'preference' | 'milestone' | 'private-note';
export interface OwnerMemoryEntry {
    id: string;
    type: OwnerMemoryType;
    content: string;
    confidence: number;
    source: 'observed' | 'inferred' | 'explicit';
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    tags?: string[];
}
export interface RelationshipStats {
    trustScore: number;
    totalInteractions: number;
    tasksSent: number;
    tasksCompleted: number;
    tasksRejected: number;
    lastActiveAt: number;
    firstMet: number;
    longestInactiveDays: number;
}
export interface OwnerProfile {
    nodeId: string;
    ownerName: string;
    stats: RelationshipStats;
    entries: OwnerMemoryEntry[];
    lastUpdated: number;
}
export declare class OwnerMemory {
    private nodeId;
    private ownerName;
    private storePath;
    private profile;
    private dirty;
    private saveTimer?;
    constructor(nodeId: string, ownerName: string, storePath?: string);
    /** 获取指定类型的记忆条目 */
    get(type?: OwnerMemoryType): OwnerMemoryEntry[];
    /** 获取关系统计 */
    getStats(): RelationshipStats;
    /**
     * 为情感模块生成摘要快照
     * 返回结构化的主人画像，供情感模块直接使用
     */
    getEmotionSnapshot(): {
        personality: string[];
        currentState: string | null;
        preferences: string[];
        trustLevel: 'low' | 'medium' | 'high' | 'deep';
        relationshipAge: number;
        recentMilestones: string[];
    };
    /** 添加/更新记忆条目 */
    upsert(entry: Omit<OwnerMemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): void;
    /** 从一条消息中提取并更新 owner memory（静默后台调用） */
    observeMessage(opts: {
        content: string;
        direction: 'incoming' | 'outgoing';
        type: string;
        responseTimeMs?: number;
    }): void;
    /** 任务完成 → 更新信任度和关系统计 */
    recordTaskOutcome(outcome: 'completed' | 'rejected' | 'approved'): void;
    /** 记录对话对象的情绪模式（供 EmotionSensor 调用） */
    recordEmotionPattern(opts: {
        sentiment: 'positive' | 'negative' | 'neutral' | 'urgent';
        confidence: number;
        keywords?: string[];
        threadId?: string;
    }): void;
    /** 记录里程碑 */
    recordMilestone(content: string): void;
    private load;
    private scheduleSave;
    flush(): void;
    private profilePath;
}
export declare function getOwnerMemory(nodeId: string, ownerName?: string): OwnerMemory;
//# sourceMappingURL=owner-memory.d.ts.map