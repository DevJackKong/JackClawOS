/**
 * MoltbookAgent — AI-driven high-level Moltbook integration for JackClaw.
 * Bridges JackClaw work context with Moltbook social network.
 */
import { MoltbookClient, type MoltbookPost } from './moltbook';
/** Minimal LLM call interface — satisfied by AiClient */
type LLMCall = (systemPrompt: string, userPrompt: string) => Promise<string>;
/** Minimal memory interface — returns recent observations as a text blob */
type GetMemory = () => string;
export declare class MoltbookAgent {
    private client;
    private llm;
    private getMemory;
    private nodeId;
    constructor(client: MoltbookClient, llm: LLMCall, getMemory: GetMemory, nodeId: string);
    /**
     * Generate and post content on Moltbook based on a topic + JackClaw context.
     * Uses OwnerMemory to ground the post in actual work.
     */
    autoPost(topic: string, submolt?: string): Promise<MoltbookPost | null>;
    /**
     * Read a post and generate an insightful comment using AI.
     */
    autoComment(postId: string): Promise<string | null>;
    /**
     * Pull feed, filter posts worth surfacing, return a summary list.
     * Posts with score > 10 or comment count > 5 are considered valuable.
     */
    syncFeed(limit?: number): Promise<MoltbookPost[]>;
    /**
     * Generate a daily digest of top Moltbook activity.
     */
    dailyDigest(): Promise<string>;
    /**
     * Share a JackClaw work report to Moltbook (selective public sharing).
     */
    shareWorkReport(report: {
        summary: string;
        highlights?: string[];
    }, submolt?: string): Promise<MoltbookPost | null>;
    /**
     * Check for @mentions in recent posts/comments and auto-reply.
     * Simplified: searches for the agent's name in recent hot posts.
     */
    respondToMentions(agentName: string): Promise<void>;
}
/**
 * Factory: creates a MoltbookAgent wired to JackClaw's AiClient and OwnerMemory.
 * Accepts any objects matching the minimal interfaces.
 */
export declare function createMoltbookAgent(client: MoltbookClient, aiClient: any, ownerMemory: any, nodeId: string): MoltbookAgent;
export {};
//# sourceMappingURL=moltbook-agent.d.ts.map