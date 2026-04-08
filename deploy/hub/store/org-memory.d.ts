export type OrgMemoryType = 'lesson' | 'decision' | 'feedback' | 'milestone';
export interface OrgMemEntry {
    id: string;
    type: OrgMemoryType;
    content: string;
    nodeId: string;
    tags: string[];
    createdAt: number;
}
export type { OrgMemoryType as OrgMemoryTypeCompat };
export declare class OrgMemoryStore {
    private entries;
    constructor();
    /** Return all entries (newest first) */
    list(): OrgMemEntry[];
    /** Query with optional type filter and limit */
    query(type?: OrgMemoryType, limit?: number): OrgMemEntry[];
    /** Get single entry by id */
    get(id: string): OrgMemEntry | undefined;
    /** Keyword search (case-insensitive includes on content + tags) */
    search(query: string): OrgMemEntry[];
    /** Add a new entry */
    add(input: {
        type: OrgMemoryType;
        content: string;
        nodeId: string;
        tags?: string[];
    }): OrgMemEntry;
    /** Delete entry by id, returns true if found */
    delete(id: string): boolean;
    private load;
    private flush;
}
//# sourceMappingURL=org-memory.d.ts.map