"use strict";
/**
 * Node Social Handler
 *
 * 处理 Hub 通过 WebSocket 推送的 social 事件：
 * - 'social'                 — 收到社交消息
 * - 'social_contact_request' — 收到联系请求
 * - 'social_contact_response'— 联系请求结果
 *
 * 主人回复通过 Hub /api/social/reply 转发
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialHandler = void 0;
const ai_filter_1 = require("./ai-filter");
const ai_emotion_1 = require("./ai-emotion");
const ai_translator_1 = require("./ai-translator");
const task_executor_1 = require("./task-executor");
class SocialHandler {
    opts;
    filter = new ai_filter_1.MessageFilter();
    emotion = (0, ai_emotion_1.getEmotionSensor)();
    constructor(opts) {
        this.opts = opts;
    }
    /** 处理 WebSocket 收到的事件 */
    handleEvent(event, data) {
        switch (event) {
            case 'social':
                this._onSocialMessage(data);
                break;
            case 'social_contact_request':
                this._onContactRequest(data);
                break;
            case 'social_contact_response':
                this._onContactResponse(data);
                break;
            default:
                // 不是 social 事件，忽略
                break;
        }
    }
    async _onSocialMessage(msg) {
        const from = msg.fromAgent;
        const content = msg.content.slice(0, 120);
        const result = this.filter.analyze(msg);
        if (result.action === 'block') {
            // Silent discard — already logged by MessageFilter
            console.log(`[social] 🚫 Blocked message from ${from}: ${result.reason}`);
            return;
        }
        // ── Task routing: if message type is 'task', delegate to TaskExecutor ──
        const msgAny = msg;
        if (msgAny.type === 'task' && this.opts.aiClient && this.opts.ownerMemory) {
            await this._handleTaskMessage(msg);
            return;
        }
        // Emotion analysis
        const emotion = this.emotion.analyze(msg.content);
        const threadId = msg.thread ?? msg.id;
        this.emotion.trackMoodHistory(threadId, emotion.sentiment, emotion.confidence);
        // Persist emotion pattern to OwnerMemory (background contact profile)
        this.opts.ownerMemory?.recordEmotionPattern({
            sentiment: emotion.sentiment,
            confidence: emotion.confidence,
            keywords: emotion.keywords,
            threadId,
        });
        // Build emotion hint for owner notification
        const emotionHint = this._emotionHint(emotion.sentiment);
        // Auto-translate incoming message if enabled
        let displayContent = msg.content;
        if (this.opts.aiClient) {
            try {
                const translator = (0, ai_translator_1.getTranslator)(this.opts.aiClient);
                const translated = await translator.translateMessage(msg);
                if (translated) {
                    displayContent = translated.combined;
                    console.log(`[social] 🌐 Translated ${translated.fromLang} → ${translated.toLang}`);
                }
            }
            catch (err) {
                console.warn(`[social] Translation failed: ${err.message}`);
            }
        }
        if (result.action === 'flag') {
            console.log(`[social] ⚠️  Suspicious message from ${from}: ${content} [${result.reason}]`);
            if (this.opts.webhookUrl) {
                this._pushToOwner({
                    type: 'social_message',
                    from,
                    content: displayContent,
                    messageId: msg.id,
                    thread: msg.thread,
                    ts: msg.ts,
                    warning: result.reason,
                    filterConfidence: result.confidence,
                    emotionHint,
                    emotion: emotion.sentiment,
                });
            }
            return;
        }
        // action === 'allow'
        console.log(`[social] 📨 Message from ${from}: ${content}${emotionHint ? ` ${emotionHint}` : ''}`);
        if (this.opts.webhookUrl) {
            this._pushToOwner({
                type: 'social_message',
                from,
                content: displayContent,
                messageId: msg.id,
                thread: msg.thread,
                ts: msg.ts,
                emotionHint,
                emotion: emotion.sentiment,
                emotionKeywords: emotion.keywords,
            });
        }
    }
    /** 根据情绪返回给主人的提示文字 */
    _emotionHint(sentiment) {
        switch (sentiment) {
            case 'urgent': return '⚠️ 对方似乎比较着急';
            case 'negative': return '😟 对方情绪有些负面';
            case 'positive': return '😊 对方心情不错';
            default: return '';
        }
    }
    /** Handle messages with type='task' by delegating to TaskExecutor and auto-replying */
    async _handleTaskMessage(msg) {
        if (!this.opts.aiClient || !this.opts.ownerMemory)
            return;
        const msgAny = msg;
        const taskType = msgAny.taskType ?? 'chat';
        console.log(`[social] 🤖 Task message from ${msg.fromAgent}, type=${taskType}`);
        const executor = (0, task_executor_1.getTaskExecutor)(this.opts.nodeId, this.opts.aiClient, this.opts.ownerMemory);
        const taskReq = (0, task_executor_1.createTaskRequest)(msg.content, taskType, {
            model: msgAny.model,
            maxTokens: msgAny.maxTokens,
        });
        try {
            const result = await executor.execute(taskReq);
            console.log(`[social] ✅ Task ${taskReq.id} completed in ${result.duration}ms`);
            await this.ownerReply({
                replyToId: msg.id,
                content: result.output || `[Task ${result.status}]`,
                fromHuman: this.opts.humanId ?? this.opts.nodeId,
                fromAgent: this.opts.agentHandle ?? this.opts.nodeId,
            }).catch(err => console.warn(`[social] Task auto-reply failed: ${err.message}`));
        }
        catch (err) {
            console.error(`[social] Task execution failed: ${err.message}`);
        }
    }
    _onContactRequest(req) {
        console.log(`[social] 🤝 Contact request from ${req.fromAgent}: "${req.message}"`);
        if (this.opts.webhookUrl) {
            this._pushToOwner({
                type: 'social_contact_request',
                fromAgent: req.fromAgent,
                message: req.message,
                purpose: req.purpose,
                requestId: req.id,
                ts: req.ts,
            });
        }
    }
    _onContactResponse(resp) {
        const verb = resp.decision === 'accept' ? '接受了' : '拒绝了';
        console.log(`[social] 📋 Contact request ${resp.requestId} ${verb}`);
        if (this.opts.webhookUrl) {
            this._pushToOwner({
                type: 'social_contact_response',
                requestId: resp.requestId,
                decision: resp.decision,
                message: resp.message,
            });
        }
    }
    /**
     * 主人通过 webhookUrl 的推送（fire-and-forget）
     */
    _pushToOwner(payload) {
        const url = this.opts.webhookUrl;
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'jackclaw-social', nodeId: this.opts.nodeId, ...payload }),
        }).catch((err) => {
            console.warn(`[social] webhook push failed: ${err.message}`);
        });
    }
    /**
     * 主人回复某条社交消息（通过 Hub /api/social/reply 转发）
     * 如果对方语言与主人语言不同，且 autoTranslate 开启，自动翻译后发送
     */
    async ownerReply(opts) {
        let sendContent = opts.content;
        if (this.opts.aiClient && opts.originalMessage) {
            try {
                const translator = (0, ai_translator_1.getTranslator)(this.opts.aiClient);
                const pref = translator.getPreference();
                if (pref.autoTranslate) {
                    const theirLang = translator.detectLanguage(opts.originalMessage.content);
                    const myDetected = translator.detectLanguage(opts.content);
                    if (theirLang !== 'unknown' && theirLang !== myDetected) {
                        const translated = await translator.translate(opts.content, myDetected, theirLang);
                        sendContent = translated;
                        console.log(`[social] 🌐 Reply translated ${myDetected} → ${theirLang}`);
                    }
                }
            }
            catch (err) {
                console.warn(`[social] Reply translation failed: ${err.message}`);
            }
        }
        const res = await fetch(`${this.opts.hubUrl}/api/social/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}) },
            body: JSON.stringify({
                replyToId: opts.replyToId,
                fromHuman: opts.fromHuman,
                fromAgent: opts.fromAgent,
                content: sendContent,
                type: 'text',
            }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`[social] reply failed: ${res.status} ${body}`);
        }
        const data = await res.json();
        console.log(`[social] Reply sent: ${data.messageId}`);
    }
}
exports.SocialHandler = SocialHandler;
//# sourceMappingURL=social-handler.js.map