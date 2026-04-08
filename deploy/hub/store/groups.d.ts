/**
 * GroupStore — 群组 & 频道持久化存储
 *
 * - 内存 + JSON 文件双写
 * - 支持群组（group）和频道（channel）
 * - 频道：只有 admins 可发消息，其余成员是订阅者
 * - 支持邀请码、消息历史、置顶消息
 */
export type GroupType = 'group' | 'channel';
export interface Group {
    id: string;
    name: string;
    type: GroupType;
    avatar?: string;
    announcement?: string;
    createdBy: string;
    admins: string[];
    members: string[];
    inviteCode: string;
    createdAt: number;
    updatedAt: number;
    pinnedMessageIds: string[];
}
export interface GroupMessage {
    id: string;
    groupId: string;
    from: string;
    content: string;
    replyToId?: string;
    ts: number;
}
export declare class GroupStore {
    private groups;
    private messages;
    private inviteIndex;
    constructor();
    private persist;
    private persistMessages;
    private generateInviteCode;
    create(params: {
        name: string;
        members: string[];
        createdBy: string;
        avatar?: string;
        type?: GroupType;
    }): Group;
    get(id: string): Group | null;
    listForMember(nodeId: string): Group[];
    update(id: string, patch: {
        name?: string;
        avatar?: string;
        announcement?: string;
    }): Group | null;
    addMembers(groupId: string, nodeIds: string[]): Group | null;
    removeMember(groupId: string, nodeId: string): Group | null;
    isAdmin(groupId: string, nodeId: string): boolean;
    isMember(groupId: string, nodeId: string): boolean;
    joinByInvite(inviteCode: string, nodeId: string): Group | null;
    addMessage(params: {
        groupId: string;
        from: string;
        content: string;
        replyToId?: string;
    }): GroupMessage;
    getMessages(groupId: string, limit?: number, before?: number): GroupMessage[];
    pinMessage(groupId: string, messageId: string): Group | null;
}
export declare const groupStore: GroupStore;
//# sourceMappingURL=groups.d.ts.map