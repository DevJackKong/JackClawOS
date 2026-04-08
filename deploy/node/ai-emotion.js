"use strict";
/**
 * AI Emotion Sensor — 纯规则引擎，无需 LLM
 *
 * 分析文本情绪，追踪对话氛围，建议回复语气
 * 历史存储：~/.jackclaw/node/emotion-history.jsonl
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmotionSensor = void 0;
exports.getEmotionSensor = getEmotionSensor;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// ─── 词库 ──────────────────────────────────────────────────────────────────────
const POSITIVE_WORDS = [
    '开心', '高兴', '太好了', '棒', '感谢', '谢谢', '谢', '好的', '很好', '完美',
    '爱', '喜欢', '满意', '优秀', '厉害', '赞', '妙', '愉快',
    'nice', 'great', 'love', 'thanks', 'thank', 'awesome', 'perfect',
    'happy', 'good', 'excellent', 'wonderful', 'fantastic', 'cool',
];
const NEGATIVE_WORDS = [
    '生气', '愤怒', '失望', '难过', '糟糕', '差劲', '烂', '不满', '抱怨',
    '讨厌', '恨', '烦', '崩溃', '无语', '搞什么', '什么玩意',
    'angry', 'disappointed', 'terrible', 'awful', 'hate', 'bad',
    'worst', 'horrible', 'upset', 'frustrated', 'annoyed', 'sucks',
];
const URGENT_WORDS = [
    '紧急', '急', '马上', '立刻', '赶快', '快点', '尽快', '速', 'asap',
    'urgent', 'emergency', 'immediately', 'right now', 'hurry',
    '必须今天', '今天必须', '截止', 'deadline', '火急',
];
// ─── EmotionSensor ─────────────────────────────────────────────────────────────
class EmotionSensor {
    historyPath;
    constructor(storePath = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node')) {
        fs_1.default.mkdirSync(storePath, { recursive: true });
        this.historyPath = path_1.default.join(storePath, 'emotion-history.jsonl');
    }
    // ── 核心分析 ────────────────────────────────────────────────────────────────
    /** 分析单条文本的情绪 */
    analyze(text) {
        const lower = text.toLowerCase();
        const urgentHits = URGENT_WORDS.filter(w => lower.includes(w.toLowerCase()));
        const positiveHits = POSITIVE_WORDS.filter(w => lower.includes(w.toLowerCase()));
        const negativeHits = NEGATIVE_WORDS.filter(w => lower.includes(w.toLowerCase()));
        // 优先级：urgent > negative > positive > neutral
        if (urgentHits.length > 0) {
            return {
                sentiment: 'urgent',
                confidence: Math.min(0.95, 0.6 + urgentHits.length * 0.1),
                keywords: urgentHits,
            };
        }
        if (negativeHits.length > 0 && negativeHits.length >= positiveHits.length) {
            return {
                sentiment: 'negative',
                confidence: Math.min(0.95, 0.55 + negativeHits.length * 0.1),
                keywords: negativeHits,
            };
        }
        if (positiveHits.length > 0) {
            return {
                sentiment: 'positive',
                confidence: Math.min(0.95, 0.55 + positiveHits.length * 0.1),
                keywords: positiveHits,
            };
        }
        return { sentiment: 'neutral', confidence: 0.7, keywords: [] };
    }
    // ── 对话氛围 ────────────────────────────────────────────────────────────────
    /** 分析整个对话（消息列表）的整体氛围 */
    getConversationMood(messages) {
        if (messages.length === 0) {
            return { sentiment: 'neutral', confidence: 0.5, keywords: [] };
        }
        const counts = { positive: 0, negative: 0, neutral: 0, urgent: 0 };
        const allKeywords = [];
        let totalConfidence = 0;
        for (const msg of messages) {
            const r = this.analyze(msg.content);
            counts[r.sentiment]++;
            totalConfidence += r.confidence;
            allKeywords.push(...r.keywords);
        }
        // 加权：urgent/negative 权重更高
        const weighted = {
            urgent: counts.urgent * 3,
            negative: counts.negative * 2,
            positive: counts.positive * 1.5,
            neutral: counts.neutral * 1,
        };
        const dominant = Object.keys(weighted).reduce((a, b) => weighted[a] > weighted[b] ? a : b);
        return {
            sentiment: dominant,
            confidence: Math.min(0.95, totalConfidence / messages.length),
            keywords: [...new Set(allKeywords)].slice(0, 10),
        };
    }
    // ── 语气建议 ────────────────────────────────────────────────────────────────
    /**
     * 根据对方情绪建议回��语气
     * 返回建议字符串，可附在回复草稿前
     */
    suggestTone(mood, replyDraft) {
        switch (mood) {
            case 'urgent':
                return `[语气建议：对方很着急，请先确认收到，再给出明确时间线]\n${replyDraft}`;
            case 'negative':
                return `[语气建议：对方情绪负面，建议温和、先共情再解决问题]\n${replyDraft}`;
            case 'positive':
                return `[语气建议：对方心情不错，可以热情回应、适当互动]\n${replyDraft}`;
            default:
                return replyDraft;
        }
    }
    // ── 情绪历史 ────────────────────────────────────────────────────────────────
    /** 记录一条情绪到历史 */
    trackMoodHistory(threadId, sentiment, confidence = 0.7) {
        const entry = { threadId, sentiment, confidence, ts: Date.now() };
        fs_1.default.appendFileSync(this.historyPath, JSON.stringify(entry) + '\n', 'utf-8');
    }
    /** 读取某个 thread 的情绪报告 */
    getMoodReport(threadId) {
        const history = this._readHistory(threadId);
        if (history.length === 0) {
            return {
                threadId,
                dominant: 'neutral',
                history: [],
                trend: 'stable',
                totalMessages: 0,
            };
        }
        // 统计主导情绪
        const counts = { positive: 0, negative: 0, neutral: 0, urgent: 0 };
        for (const e of history)
            counts[e.sentiment]++;
        const dominant = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
        // 趋势：对比前半段和后半段
        const half = Math.floor(history.length / 2);
        const trend = this._calcTrend(history.slice(0, half), history.slice(half));
        return { threadId, dominant, history, trend, totalMessages: history.length };
    }
    // ── 内部工具 ────────────────────────────────────────────────────────────────
    _readHistory(threadId) {
        try {
            const raw = fs_1.default.readFileSync(this.historyPath, 'utf-8');
            return raw
                .split('\n')
                .filter(Boolean)
                .map(line => JSON.parse(line))
                .filter(e => e.threadId === threadId);
        }
        catch {
            return [];
        }
    }
    _scoreOf(sentiment) {
        return { positive: 2, neutral: 1, negative: -1, urgent: -0.5 }[sentiment];
    }
    _calcTrend(earlier, later) {
        if (earlier.length === 0 || later.length === 0)
            return 'stable';
        const avgEarly = earlier.reduce((s, e) => s + this._scoreOf(e.sentiment), 0) / earlier.length;
        const avgLate = later.reduce((s, e) => s + this._scoreOf(e.sentiment), 0) / later.length;
        const delta = avgLate - avgEarly;
        if (delta > 0.3)
            return 'improving';
        if (delta < -0.3)
            return 'worsening';
        return 'stable';
    }
}
exports.EmotionSensor = EmotionSensor;
// 单例
let _sensor = null;
function getEmotionSensor() {
    if (!_sensor)
        _sensor = new EmotionSensor();
    return _sensor;
}
//# sourceMappingURL=ai-emotion.js.map