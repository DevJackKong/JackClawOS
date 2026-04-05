export interface OrgNorm {
    id: string;
    title: string;
    content: string;
    category: string;
    author: string;
    createdAt: number;
    updatedAt: number;
}
export declare class OrgNormStore {
    private norms;
    constructor();
    /** Return all norms */
    list(): OrgNorm[];
    /** Get single norm by id */
    get(id: string): OrgNorm | undefined;
    /** Add a new norm */
    add(input: {
        title: string;
        content: string;
        category?: string;
        author?: string;
    }): OrgNorm;
    /** Update an existing norm, returns updated norm or undefined */
    update(id: string, fields: Partial<Pick<OrgNorm, 'title' | 'content' | 'category' | 'author'>>): OrgNorm | undefined;
    /** Delete norm by id, returns true if found */
    delete(id: string): boolean;
    /**
     * Legacy compat: build system prompt inject from norms
     * Maps old scope-based filtering to category-based listing
     */
    buildSystemPromptInject(_role?: string): string;
    private load;
    private flush;
}
export declare function getOrgNormStore(): OrgNormStore;
//# sourceMappingURL=org-norm.d.ts.map