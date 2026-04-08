import type { Workspace } from '../models/tenant';
export declare class WorkspaceStore {
    private load;
    private save;
    create(orgId: string, tenantId: string, name: string, slug: string): Workspace;
    get(id: string): Workspace | null;
    listByOrg(orgId: string): Workspace[];
    listByTenant(tenantId: string): Workspace[];
    update(id: string, updates: Partial<Pick<Workspace, 'orgId' | 'tenantId' | 'name' | 'slug'>>): Workspace | null;
    delete(id: string): boolean;
}
export declare const workspaceStore: WorkspaceStore;
//# sourceMappingURL=workspace-store.d.ts.map