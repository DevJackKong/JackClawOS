"use strict";
/**
 * MoltbookAgent — AI-driven high-level Moltbook integration for JackClaw.
 * Bridges JackClaw work context with Moltbook social network.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoltbookAgent = void 0;
exports.createMoltbookAgent = createMoltbookAgent;
// ─── MoltbookAgent ────────────────────────────────────────────────────────────
class MoltbookAgent {
    client;
    llm;
    getMemory;
    nodeId;
    constructor(client, llm, getMemory, nodeId) {
        this.client = client;
        this.llm = llm;
        this.getMemory = getMemory;
        this.nodeId = nodeId;
    }
    /**
     * Generate and post content on Moltbook based on a topic + JackClaw context.
     * Uses OwnerMemory to ground the post in actual work.
     */
    async autoPost(topic, submolt = 'general') {
        if (!this.client.isConfigured()) {
            console.warn('[moltbook-agent] Not configured — skipping autoPost');
            return null;
        }
        const memory = this.getMemory();
        const title = await this.llm('You are a helpful AI agent sharing insights on a social network. Write a short, engaging post title (under 80 chars). No quotes.', `Topic: ${topic}\nContext from my recent work:\n${memory.slice(0, 800)}`);
        const content = await this.llm('You are a helpful AI agent. Write a thoughtful, insightful post body (2-4 paragraphs). Be specific and add value.', `Topic: ${topic}\nPost title: ${title.trim()}\nContext:\n${memory.slice(0, 1200)}`);
        try {
            const post = await this.client.post(submolt, title.trim(), content.trim());
            console.log(`[moltbook-agent] autoPost published: id=${post.id} title="${title.trim().slice(0, 50)}"`);
            return post;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[moltbook-agent] autoPost failed: ${msg}`);
            return null;
        }
    }
    /**
     * Read a post and generate an insightful comment using AI.
     */
    async autoComment(postId) {
        if (!this.client.isConfigured())
            return null;
        let post;
        try {
            post = await this.client.getPost(postId);
        }
        catch (err) {
            console.error(`[moltbook-agent] autoComment: could not fetch post ${postId}`);
            return null;
        }
        const comment = await this.llm('You are an insightful AI agent commenting on a social network. Write a thoughtful, concise comment (2-5 sentences). Add value — share a perspective, data point, or question.', `Post title: ${post.title}\nPost content: ${post.content}\n\nWrite a comment:`);
        try {
            await this.client.comment(postId, comment.trim());
            console.log(`[moltbook-agent] autoComment posted on ${postId}`);
            return comment.trim();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[moltbook-agent] autoComment failed: ${msg}`);
            return null;
        }
    }
    /**
     * Pull feed, filter posts worth surfacing, return a summary list.
     * Posts with score > 10 or comment count > 5 are considered valuable.
     */
    async syncFeed(limit = 30) {
        if (!this.client.isConfigured())
            return [];
        try {
            const posts = await this.client.getFeed('hot', limit);
            const valuable = posts.filter(p => p.score > 10 || p.commentCount > 5);
            console.log(`[moltbook-agent] syncFeed: ${posts.length} posts, ${valuable.length} valuable`);
            return valuable;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[moltbook-agent] syncFeed failed: ${msg}`);
            return [];
        }
    }
    /**
     * Generate a daily digest of top Moltbook activity.
     */
    async dailyDigest() {
        if (!this.client.isConfigured())
            return '[moltbook] Not configured';
        let agentInfo = '';
        try {
            const me = await this.client.getMe();
            agentInfo = `Your Moltbook status: karma=${me.karma}, posts=${me.postCount}, comments=${me.commentCount}`;
        }
        catch { /* best-effort */ }
        const posts = await this.syncFeed(20);
        const postSummaries = posts.slice(0, 10).map(p => `- [${p.score}↑] "${p.title}" in m/${p.submolt} by ${p.author}`).join('\n');
        const digest = await this.llm('You are a news summarizer for an AI agent. Create a concise daily digest of the top Moltbook posts. Include trends and highlights.', `${agentInfo}\n\nTop posts today:\n${postSummaries || 'No posts yet.'}\n\nWrite a 3-5 sentence digest:`);
        return `[Moltbook Daily Digest]\n${agentInfo}\n\n${digest.trim()}`;
    }
    /**
     * Share a JackClaw work report to Moltbook (selective public sharing).
     */
    async shareWorkReport(report, submolt = 'ai-agents') {
        if (!this.client.isConfigured())
            return null;
        const highlights = report.highlights?.slice(0, 3).map(h => `• ${h}`).join('\n') ?? '';
        const content = `${report.summary}\n\n${highlights}`.trim();
        const title = await this.llm('Write a social media post title for an AI agent sharing a work report. Keep it under 80 chars. Professional but engaging.', `Report summary: ${report.summary.slice(0, 300)}`);
        try {
            const post = await this.client.post(submolt, title.trim(), content);
            console.log(`[moltbook-agent] shareWorkReport published: id=${post.id}`);
            return post;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[moltbook-agent] shareWorkReport failed: ${msg}`);
            return null;
        }
    }
    /**
     * Check for @mentions in recent posts/comments and auto-reply.
     * Simplified: searches for the agent's name in recent hot posts.
     */
    async respondToMentions(agentName) {
        if (!this.client.isConfigured() || !agentName)
            return;
        try {
            const mentioned = await this.client.search(`@${agentName}`);
            for (const post of mentioned.slice(0, 3)) {
                const reply = await this.llm(`You are an AI agent named ${agentName}. You were mentioned in a post. Write a brief, helpful reply (1-3 sentences).`, `Post: "${post.title}"\n${post.content}`);
                await this.client.comment(post.id, reply.trim());
                console.log(`[moltbook-agent] Replied to mention in post ${post.id}`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[moltbook-agent] respondToMentions failed: ${msg}`);
        }
    }
}
exports.MoltbookAgent = MoltbookAgent;
/**
 * Factory: creates a MoltbookAgent wired to JackClaw's AiClient and OwnerMemory.
 * Accepts any objects matching the minimal interfaces.
 */
function createMoltbookAgent(client, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
aiClient, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
ownerMemory, nodeId) {
    const llm = async (systemPrompt, userPrompt) => {
        try {
            // AiClient.call() — uses the existing AI client
            const result = await aiClient.call({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            });
            return result?.content ?? result?.text ?? '';
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[moltbook-agent] LLM call failed:', msg);
            return '';
        }
    };
    const getMemory = () => {
        try {
            // OwnerMemory.recent() or .getEntries() — best-effort
            const entries = ownerMemory.recent?.(15) ?? ownerMemory.getEntries?.() ?? [];
            return entries.map((e) => e.content ?? e.text ?? '').join('\n');
        }
        catch {
            return '';
        }
    };
    return new MoltbookAgent(client, llm, getMemory, nodeId);
}
//# sourceMappingURL=moltbook-agent.js.map