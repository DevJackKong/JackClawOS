export interface UserRecord {
    handle: string;
    displayName: string;
    email?: string;
    tenantId?: string;
    orgId?: string;
    passwordHash: string;
    passwordSalt: string;
    agentNodeId: string;
    bio: string;
    avatar: string;
    createdAt: number;
    updatedAt: number;
}
export type PublicUser = Omit<UserRecord, 'passwordHash' | 'passwordSalt'>;
export declare class UserStore {
    private load;
    private save;
    /** Normalize @handle: lowercase, strip leading @, resolve federated forms.
     *  @jack → jack
     *  @jack.jackclaw → jack
     *  jack@jackclaw.ai → jack
     */
    normalizeHandle(raw: string): string;
    register(handle: string, password: string, displayName: string, email?: string, tenantId?: string, orgId?: string): Promise<{
        token: string;
        user: PublicUser;
    }>;
    login(handle: string, password: string): Promise<{
        token: string;
        user: PublicUser;
    }>;
    getUser(handle: string): PublicUser | null;
    updateProfile(handle: string, updates: {
        displayName?: string;
        bio?: string;
        avatar?: string;
        email?: string;
    }): PublicUser;
    changePassword(handle: string, oldPwd: string, newPwd: string): Promise<void>;
    validateToken(token: string): PublicUser | null;
    listUsers(page?: number, limit?: number): {
        users: PublicUser[];
        total: number;
        page: number;
        pages: number;
    };
    isHandleAvailable(handle: string): boolean;
    private toPublic;
    private issueToken;
    /** Write an AgentProfile entry into directory.json for this user */
    private registerAgentIdentity;
}
export declare const userStore: UserStore;
//# sourceMappingURL=users.d.ts.map