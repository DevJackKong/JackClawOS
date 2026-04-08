/**
 * MoltbookClient — native integration with the Moltbook AI Agent social network.
 * Uses Node.js native fetch (no axios). Handles 429 rate limiting with retry-after.
 * Config stored at ~/.jackclaw/node/moltbook.json
 */
export interface MoltbookAgentInfo {
    name: string;
    description: string;
    karma: number;
    postCount: number;
    commentCount: number;
    createdAt?: string;
}
export interface MoltbookPost {
    id: string;
    title: string;
    content: string;
    submolt: string;
    url?: string;
    author: string;
    score: number;
    commentCount: number;
    createdAt: string;
}
export interface MoltbookComment {
    id: string;
    content: string;
    author: string;
    postId: string;
    parentId?: string;
    createdAt: string;
}
export interface MoltbookSubmolt {
    name: string;
    description: string;
    subscriberCount: number;
}
export interface MoltbookConfig {
    apiKey: string;
    agent?: {
        name: string;
        description: string;
        karma?: number;
    };
}
export declare class MoltbookClient {
    private apiKey;
    private storedConfig;
    constructor(apiKey?: string);
    private loadConfig;
    saveConfig(config: MoltbookConfig): void;
    isConfigured(): boolean;
    getStoredConfig(): MoltbookConfig | null;
    private request;
    /** Register a new Agent on Moltbook. Persists returned api_key to config file. */
    register(name: string, description: string): Promise<MoltbookAgentInfo>;
    /** Get current Agent info (karma, post counts, etc.) */
    getMe(): Promise<MoltbookAgentInfo>;
    /** Create a new post. Rate limit: 1 post per 30 min. */
    post(submolt: string, title: string, content: string, url?: string): Promise<MoltbookPost>;
    /** Get posts list sorted by hot/new/top/rising */
    getPosts(sort?: 'hot' | 'new' | 'top' | 'rising', limit?: number): Promise<MoltbookPost[]>;
    /** Get a single post by ID */
    getPost(postId: string): Promise<MoltbookPost>;
    /** Comment on a post. Rate limit: 50 comments/hour. */
    comment(postId: string, content: string, parentId?: string): Promise<MoltbookComment>;
    upvote(postId: string): Promise<void>;
    downvote(postId: string): Promise<void>;
    /** Get personalized feed */
    getFeed(sort?: 'hot' | 'new' | 'top' | 'rising', limit?: number): Promise<MoltbookPost[]>;
    /** Full-text search */
    search(query: string): Promise<MoltbookPost[]>;
    listSubmolts(): Promise<MoltbookSubmolt[]>;
    subscribe(submolt: string): Promise<void>;
    unsubscribe(submolt: string): Promise<void>;
    follow(agentName: string): Promise<void>;
    unfollow(agentName: string): Promise<void>;
}
//# sourceMappingURL=moltbook.d.ts.map