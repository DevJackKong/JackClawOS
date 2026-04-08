"use strict";
/**
 * OwnerMemory — Agent 主人记忆区
 *
 * 设计原则：
 * 1. 与 WorkMemory 完全隔离 — 工作调用不读此区，情感模块不读工作区
 * 2. 被动积累 — 从日常对话中静默提取，不打扰主人
 * 3. 未来情感模块的数据源 — 结构化存储，随时可接入
 * 4. 主人不可见（默认） — Agent 的私人观察，提升自然度
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OwnerMemory = void 0;
exports.getOwnerMemory = getOwnerMemory;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// ─── OwnerMemory ──────────────────────────────────────────────────────────────
class OwnerMemory {
    nodeId;
    ownerName;
    storePath;
    profile;
    dirty = false;
    saveTimer;
    constructor(nodeId, ownerName, storePath = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'owner-memory')) {
        this.nodeId = nodeId;
        this.ownerName = ownerName;
        this.storePath = storePath;
        fs_1.default.mkdirSync(storePath, { recursive: true });
        this.profile = this.load();
    }
    // ─── 读取 ──────────────────────────────────────────────────────────────────
    /** 获取指定类型的记忆条目 */
    get(type) {
        const now = Date.now();
        const entries = this.profile.entries
            .filter(e => !e.expiresAt || e.expiresAt > now) // 过滤已过期
            .filter(e => !type || e.type === type)
            .sort((a, b) => b.updatedAt - a.updatedAt);
        return entries;
    }
    /** 获取关系统计 */
    getStats() {
        return { ...this.profile.stats };
    }
    /**
     * 为情感模块生成摘要快照
     * 返回结构化的主人画像，供情感模块直接使用
     */
    getEmotionSnapshot() {
        const personality = this.get('personality').slice(0, 5).map(e => e.content);
        const state = this.get('emotional-state')[0]?.content ?? null;
        const preferences = this.get('preference').slice(0, 5).map(e => e.content);
        const stats = this.profile.stats;
        const trustLevel = stats.trustScore >= 80 ? 'deep'
            : stats.trustScore >= 60 ? 'high'
                : stats.trustScore >= 40 ? 'medium'
                    : 'low';
        const relationshipAge = Math.floor((Date.now() - stats.firstMet) / (1000 * 60 * 60 * 24));
        const recentMilestones = this.get('milestone')
            .slice(0, 3)
            .map(e => e.content);
        return { personality, currentState: state, preferences, trustLevel, relationshipAge, recentMilestones };
    }
    // ─── 写入 ──────────────────────────────────────────────────────────────────
    /** 添加/更新记忆条目 */
    upsert(entry) {
        const now = Date.now();
        // 同类型+相同内容：更新 confidence
        const existing = this.profile.entries.find(e => e.type === entry.type && e.content === entry.content);
        if (existing) {
            existing.confidence = Math.min(1, existing.confidence + 0.1);
            existing.updatedAt = now;
            if (entry.expiresAt)
                existing.expiresAt = entry.expiresAt;
        }
        else {
            this.profile.entries.push({
                ...entry,
                id: `om-${now}-${Math.random().toString(36).slice(2, 8)}`,
                createdAt: now,
                updatedAt: now,
            });
        }
        this.profile.lastUpdated = now;
        this.scheduleSave();
    }
    /** 从一条消息中提取并更新 owner memory（静默后台调用） */
    observeMessage(opts) {
        const now = Date.now();
        const stats = this.profile.stats;
        stats.totalInteractions++;
        stats.lastActiveAt = now;
        // 更新活跃时间偏好（按小时统计）
        const hour = new Date().getHours();
        this.upsert({
            type: 'preference',
            content: `活跃时段：${hour}:00-${hour + 1}:00`,
            confidence: 0.3,
            source: 'observed',
            tags: ['active-hours'],
        });
        // 回复速度 → 情绪状态推断
        if (opts.direction === 'incoming' && opts.responseTimeMs) {
            if (opts.responseTimeMs < 30000) {
                this.upsert({
                    type: 'emotional-state',
                    content: '响应迅速，当前状态活跃',
                    confidence: 0.6,
                    source: 'inferred',
                    expiresAt: now + 4 * 60 * 60 * 1000, // 4h TTL
                });
            }
            else if (opts.responseTimeMs > 3600000) {
                this.upsert({
                    type: 'emotional-state',
                    content: '响应较慢（>1h），可能忙碌或休息',
                    confidence: 0.5,
                    source: 'inferred',
                    expiresAt: now + 2 * 60 * 60 * 1000, // 2h TTL
                });
            }
        }
        // 消息长度 → 沟通风格
        const wordCount = opts.content.length;
        if (wordCount < 20 && opts.direction === 'incoming') {
            this.upsert({
                type: 'personality',
                content: '偏好简短指令，不喜欢冗长回复',
                confidence: 0.4,
                source: 'inferred',
            });
        }
        this.scheduleSave();
    }
    /** 任务完成 → 更新信任度和关系统计 */
    recordTaskOutcome(outcome) {
        const stats = this.profile.stats;
        if (outcome === 'completed') {
            stats.tasksCompleted++;
            stats.trustScore = Math.min(100, stats.trustScore + 1);
        }
        else if (outcome === 'rejected') {
            stats.tasksRejected++;
            stats.trustScore = Math.max(0, stats.trustScore - 3);
        }
        else if (outcome === 'approved') {
            stats.trustScore = Math.min(100, stats.trustScore + 2);
        }
        this.scheduleSave();
    }
    /** 记录对话对象的情绪模式（供 EmotionSensor 调用） */
    recordEmotionPattern(opts) {
        const now = Date.now();
        const ttl = opts.sentiment === 'neutral' ? 0 : 6 * 60 * 60 * 1000; // 6h TTL，中性不过期
        const keywordStr = opts.keywords?.length ? `，关键词：${opts.keywords.slice(0, 5).join('/')}` : '';
        const contentMap = {
            positive: `对话情绪积极${keywordStr}`,
            negative: `对话情绪负面${keywordStr}`,
            urgent: `对话有紧迫感${keywordStr}`,
            neutral: `对话情绪平稳`,
        };
        this.upsert({
            type: 'emotional-state',
            content: contentMap[opts.sentiment],
            confidence: opts.confidence,
            source: 'inferred',
            expiresAt: ttl > 0 ? now + ttl : undefined,
            tags: ['emotion-sensor', opts.sentiment, ...(opts.threadId ? [`thread:${opts.threadId}`] : [])],
        });
    }
    /** 记录里程碑 */
    recordMilestone(content) {
        this.upsert({
            type: 'milestone',
            content: `${new Date().toLocaleDateString('zh-CN')} ${content}`,
            confidence: 1,
            source: 'explicit',
        });
    }
    // ─── 持久化 ────────────────────────────────────────────────────────────────
    load() {
        const file = this.profilePath();
        try {
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
        }
        catch {
            return {
                nodeId: this.nodeId,
                ownerName: this.ownerName,
                stats: {
                    trustScore: 50,
                    totalInteractions: 0,
                    tasksSent: 0,
                    tasksCompleted: 0,
                    tasksRejected: 0,
                    lastActiveAt: Date.now(),
                    firstMet: Date.now(),
                    longestInactiveDays: 0,
                },
                entries: [],
                lastUpdated: Date.now(),
            };
        }
    }
    scheduleSave() {
        if (this.saveTimer)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), 2000); // 2s 防抖
    }
    flush() {
        fs_1.default.writeFileSync(this.profilePath(), JSON.stringify(this.profile, null, 2));
        this.dirty = false;
    }
    profilePath() {
        return path_1.default.join(this.storePath, `${this.nodeId}.json`);
    }
}
exports.OwnerMemory = OwnerMemory;
// 单例工厂
const instances = new Map();
function getOwnerMemory(nodeId, ownerName = 'owner') {
    if (!instances.has(nodeId)) {
        instances.set(nodeId, new OwnerMemory(nodeId, ownerName));
    }
    return instances.get(nodeId);
}
//# sourceMappingURL=owner-memory.js.map