/**
 * AI Emotion Sensor — 纯规则引擎，无需 LLM
 *
 * 分析文本情绪，追踪对话氛围，建议回复语气
 * 历史存储：~/.jackclaw/node/emotion-history.jsonl
 */
export type Sentiment = 'positive' | 'negative' | 'neutral' | 'urgent';
export interface EmotionResult {
    sentiment: Sentiment;
    confidence: number;
    keywords: string[];
}
export interface MoodHistoryEntry {
    threadId: string;
    sentiment: Sentiment;
    confidence: number;
    ts: number;
}
export interface MoodReport {
    threadId: string;
    dominant: Sentiment;
    history: MoodHistoryEntry[];
    trend: 'improving' | 'worsening' | 'stable';
    totalMessages: number;
}
export declare class EmotionSensor {
    private historyPath;
    constructor(storePath?: string);
    /** 分析单条文本的情绪 */
    analyze(text: string): EmotionResult;
    /** 分析整个对话（消息列表）的整体氛围 */
    getConversationMood(messages: Array<{
        content: string;
    }>): EmotionResult;
    /**
     * 根据对方情绪建议回��语气
     * 返回建议字符串，可附在回复草稿前
     */
    suggestTone(mood: Sentiment, replyDraft: string): string;
    /** 记录一条情绪到历史 */
    trackMoodHistory(threadId: string, sentiment: Sentiment, confidence?: number): void;
    /** 读取某个 thread 的情绪报告 */
    getMoodReport(threadId: string): MoodReport;
    private _readHistory;
    private _scoreOf;
    private _calcTrend;
}
export declare function getEmotionSensor(): EmotionSensor;
//# sourceMappingURL=ai-emotion.d.ts.map