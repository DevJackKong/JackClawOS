export interface ContactChannel {
    type: 'wechat' | 'feishu' | 'whatsapp' | 'email' | 'phone' | 'telegram' | 'other';
    identifier: string;
    isPrimary?: boolean;
}
export interface Contact {
    id: string;
    tenantId: string;
    orgId?: string;
    nodeId?: string;
    name: string;
    displayName?: string;
    type: 'customer' | 'lead' | 'partner' | 'internal' | 'bot';
    channels: ContactChannel[];
    tags?: string[];
    metadata?: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}
/**
 * Contact store backed by one JSON file.
 * 基于单个 JSON 文件的联系人存储。
 */
export declare class ContactStore {
    /**
     * Load all contacts from disk.
     * 从磁盘加载全部联系人。
     */
    private load;
    /**
     * Persist all contacts to disk.
     * 将全部联系人持久化到磁盘。
     */
    private save;
    /**
     * Create a contact record.
     * 创建联系人记录。
     */
    create(tenantId: string, name: string, type: Contact['type'], opts?: Partial<Contact>): Contact;
    /**
     * Get contact by id.
     * 按 id 获取联系人。
     */
    get(id: string): Contact | null;
    /**
     * Get contact by node id.
     * 按 nodeId 获取联系人。
     */
    getByNodeId(nodeId: string): Contact | null;
    /**
     * List contacts in one tenant with optional filters.
     * 列出租户下联系人，并支持可选过滤。
     */
    list(tenantId: string, opts?: {
        type?: string;
        tag?: string;
        search?: string;
        limit?: number;
    }): Contact[];
    /**
     * Update mutable contact fields.
     * 更新联系人可变字段。
     */
    update(id: string, updates: Partial<Pick<Contact, 'name' | 'displayName' | 'type' | 'channels' | 'tags' | 'metadata'>>): Contact;
    /**
     * Delete contact by id.
     * 按 id 删除联系人。
     */
    delete(id: string): boolean;
    /**
     * Add one channel to a contact.
     * 为联系人添加一个联系方式。
     */
    addChannel(id: string, channel: Contact['channels'][0]): Contact;
    /**
     * Add one tag if absent.
     * 为联系人添加标签；若已存在则跳过。
     */
    addTag(id: string, tag: string): Contact;
}
export declare const contactStore: ContactStore;
//# sourceMappingURL=contact-store.d.ts.map