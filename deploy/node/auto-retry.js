"use strict";
/**
 * JackClaw Auto-Retry Loop — 让 AI 自主解决问题，无需人工多轮沟通
 *
 * 核心思想：AI 第一次拒绝/模糊≠真的不能解决。
 * 自动分类失败原因，重构 prompt，最多重试 N 轮，收敛最佳结果。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyResponse = classifyResponse;
exports.rewritePrompt = rewritePrompt;
exports.autoRetry = autoRetry;
// ─── 失败模式检测 ─────────────────────────────────────────────────────────────
// 软失败信号词（中英文）
const SOFT_UNCERTAINTY_SIGNALS = [
    '不确定', '可能', '也许', '大概', '或许', '需要确认', '不太清楚',
    "I'm not sure", "I'm uncertain", 'might', 'perhaps', 'I need to verify',
    'I cannot determine', '无法确认', '难以判断',
];
const SOFT_INCOMPLETE_SIGNALS = [
    '还需要', '下一步', '待完成', '未完成', '继续', '剩余',
    'still need', 'next step', 'incomplete', 'remaining', 'to be done',
];
const SOFT_CONTEXT_SIGNALS = [
    '需要更多信息', '请提供', '能否告诉我', '缺少', '不知道具体',
    'need more information', 'please provide', 'could you tell me',
    'missing', 'lack of context', 'without knowing',
];
const HARD_CAPABILITY_SIGNALS = [
    '超出我的能力', '无法实现', '技术上不可能', '物理限制',
    'beyond my capabilities', 'technically impossible', 'cannot be done',
    'physically impossible',
];
const HARD_POLICY_SIGNALS = [
    "I can't assist", "I'm not able to help", '违反政策', '不适合',
    'against my guidelines', 'harmful', 'illegal', '违法', '不道德',
];
function classifyResponse(response) {
    const lower = response.toLowerCase();
    // Hard 优先判断（不重试）
    if (HARD_POLICY_SIGNALS.some(s => lower.includes(s.toLowerCase()))) {
        return 'hard-policy';
    }
    if (HARD_CAPABILITY_SIGNALS.some(s => lower.includes(s.toLowerCase()))) {
        return 'hard-capability';
    }
    // Soft 失败
    if (SOFT_CONTEXT_SIGNALS.some(s => lower.includes(s.toLowerCase()))) {
        return 'soft-context';
    }
    if (SOFT_INCOMPLETE_SIGNALS.some(s => lower.includes(s.toLowerCase()))) {
        return 'soft-incomplete';
    }
    if (SOFT_UNCERTAINTY_SIGNALS.some(s => lower.includes(s.toLowerCase()))) {
        return 'soft-uncertainty';
    }
    // 回复过短（< 50字）也视为不完整
    if (response.trim().length < 50) {
        return 'soft-incomplete';
    }
    return 'success';
}
// ─── Prompt Rewriter ──────────────────────────────────────────────────────────
function rewritePrompt(originalMessages, failureType, failedResponse, attempt, contextHints) {
    const retryPrefix = attempt === 1
        ? '你之前的回答不够完整。'
        : `你已经尝试了 ${attempt} 次，仍未完全解决。`;
    const injections = {
        'soft-uncertainty': `${retryPrefix}
你必须给出一个具体、可执行的答案。
规则：
- 禁止使用"不确定"、"可能"、"也许"等模糊词
- 如果有多个可能答案，选择你认为最可能正确的一个，直接给出
- 可以在答案末尾用一行标注置信度（高/中/低），但必须先给出答案
- 你的回答将直接用于执行，请保持具体和可操作性`,
        'soft-incomplete': `${retryPrefix}你只完成了部分内容。
请继续完成剩余部分。不要重复已完成的内容，直接从未完成处继续。
你之前的输出：
---
${failedResponse.slice(0, 500)}
---
请继续：`,
        'soft-context': `${retryPrefix}不要要求更多信息。
基于以下已知上下文，给出你能做到的最完整答案：
${contextHints ? `\n已知上下文：\n${contextHints}\n` : ''}
如果仍有未知信息，做出合理假设并明确标注你的假设，然后继续解决问题。
禁止回复"需要更多信息"。`,
    };
    const injection = injections[failureType];
    if (!injection)
        return originalMessages;
    // 将重试指令注入为新一轮用户消息
    return [
        ...originalMessages,
        { role: 'assistant', content: failedResponse },
        { role: 'user', content: injection },
    ];
}
async function autoRetry(aiClient, opts, retryConfig = {}) {
    const { maxAttempts = 3, successEvaluator, contextExtractor, } = retryConfig;
    const failureHistory = [];
    let currentMessages = opts.messages;
    let totalTokens = 0;
    let totalSavedTokens = 0;
    let lastResponse = '';
    let lastStrategy = 'full';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await aiClient.call({
            ...opts,
            messages: currentMessages,
        });
        totalTokens += result.usage.inputTokens + result.usage.outputTokens;
        totalSavedTokens += result.usage.savedTokens;
        lastResponse = result.content;
        lastStrategy = result.strategy;
        // 自定义成功判断优先
        if (successEvaluator?.(result.content)) {
            return {
                content: result.content,
                attempts: attempt,
                failureHistory,
                finalStrategy: lastStrategy,
                totalTokens,
                totalSavedTokens,
            };
        }
        const failureType = classifyResponse(result.content);
        if (failureType === 'success') {
            return {
                content: result.content,
                attempts: attempt,
                failureHistory,
                finalStrategy: lastStrategy,
                totalTokens,
                totalSavedTokens,
            };
        }
        // 记录失败
        failureHistory.push({
            attempt,
            failureType,
            summary: result.content.slice(0, 100),
        });
        console.log(`[auto-retry] Attempt ${attempt} → ${failureType}, retrying...`);
        // Hard fail → 不重试
        if (failureType === 'hard-capability' || failureType === 'hard-policy') {
            break;
        }
        // 已到最大次数
        if (attempt === maxAttempts)
            break;
        // 重写 prompt 继续
        const contextHints = failureType === 'soft-context' ? contextExtractor?.() : undefined;
        currentMessages = rewritePrompt(currentMessages, failureType, result.content, attempt, contextHints);
    }
    // 用最后一次输出返回（即使不完美）
    return {
        content: lastResponse,
        attempts: failureHistory.length + 1,
        failureHistory,
        finalStrategy: lastStrategy,
        totalTokens,
        totalSavedTokens,
    };
}
//# sourceMappingURL=auto-retry.js.map