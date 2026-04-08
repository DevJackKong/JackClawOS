import type { MemoryEntry, NodeRef, CollabSessionState, MemDir } from '@jackclaw/memory';
export declare function broadcastMemory(entry: MemoryEntry): void;
export declare function getOrgMemories(): MemoryEntry[];
export declare function registerNodeSkills(nodeId: string, name: string, skills: string[]): void;
export declare function findExpertsBySkill(skill: string): NodeRef[];
export declare function createCollabSession(state: CollabSessionState): void;
export declare function getCollabSession(id: string): CollabSessionState | undefined;
export declare function syncCollabSession(id: string, entries: MemoryEntry[]): void;
export declare function endCollabSession(id: string, mode: string): CollabSessionState | undefined;
/** 存储某节点推送的 MemDir 条目（覆盖旧数据） */
export declare function storeNodeMemDirs(nodeId: string, entries: MemDir[]): void;
/**
 * 返回除 requestingNodeId 以外所有节点的共享 MemDir 条目。
 * 只对外暴露 project/reference 类型（push 端已过滤，此处双重保险）。
 */
export declare function getSharedMemDirs(requestingNodeId: string): MemDir[];
//# sourceMappingURL=memory.d.ts.map