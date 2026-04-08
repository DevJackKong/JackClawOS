"use strict";
/**
 * Reflexion — MIT-style Self-Reflection Engine
 *
 * 任务完成后自动评估：哪里做得好、哪里做得差、下次怎么改。
 * 反思结果写入记忆，下次类似任务自动注入 prompt。
 * 连续失败时累积反思形成改进策略。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reflexion = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
// ─── Reflexion Engine ─────────────────────────────────────────────────────────
class Reflexion {
    nodeId;
    llm;
    entries = [];
    storePath;
    maxEntries = 500;
    constructor(nodeId, llm) {
        this.nodeId = nodeId;
        this.llm = llm;
        this.storePath = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'reflexion', nodeId);
        fs_1.default.mkdirSync(this.storePath, { recursive: true });
        this.load();
    }
    // ─── 生成反思（任务完成后调用）─────────────────────────────────────────────
    async reflect(outcome) {
        // 查找是否有连续失败链
        const recentFailures = this.getRecentFailures(outcome.taskDescription, 3);
        const chainContext = recentFailures.length > 0
            ? `\n\nPrevious failures on similar tasks:\n${recentFailures.map((r, i) => `Attempt ${i + 1}: Score ${r.score}/100\n  Failed: ${r.whatFailed.join('; ')}\n  Lessons: ${r.lessonsLearned.join('; ')}`).join('\n')}`
            : '';
        let entry;
        if (this.llm) {
            const prompt = `You are a self-reflection engine. Analyze this task outcome and generate a structured reflection.

Task: ${outcome.taskDescription}
Result: ${outcome.taskResult.slice(0, 1500)}
Success: ${outcome.success}
Duration: ${outcome.duration}ms
Tokens: ${outcome.tokenUsage.input + outcome.tokenUsage.output}
${chainContext}

Return JSON only:
{
  "score": 0-100,
  "whatWorked": ["point 1", "point 2"],
  "whatFailed": ["point 1", "point 2"],
  "lessonsLearned": ["lesson 1", "lesson 2"],
  "improvementPlan": "concrete next steps to do better"
}`;
            try {
                const response = await this.llm.chat([{ role: 'user', content: prompt }], { temperature: 0.2 });
                const parsed = JSON.parse(response.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
                entry = {
                    id: crypto_1.default.randomUUID(),
                    taskId: outcome.taskId,
                    taskDescription: outcome.taskDescription,
                    success: outcome.success,
                    score: parsed.score ?? (outcome.success ? 75 : 30),
                    whatWorked: parsed.whatWorked || [],
                    whatFailed: parsed.whatFailed || [],
                    lessonsLearned: parsed.lessonsLearned || [],
                    improvementPlan: parsed.improvementPlan || '',
                    skillsUsed: outcome.skillsUsed || [],
                    duration: outcome.duration,
                    tokenUsage: outcome.tokenUsage,
                    timestamp: Date.now(),
                    previousReflexionId: recentFailures[0]?.id,
                };
            }
            catch {
                entry = this.fallbackReflection(outcome, recentFailures);
            }
        }
        else {
            entry = this.fallbackReflection(outcome, recentFailures);
        }
        this.entries.push(entry);
        this.trimOldEntries();
        this.save();
        return entry;
    }
    // ─── 获取反思上下文（任务开始前调用）───────────────────────────────────────
    getReflexionContext(taskDescription, limit = 3) {
        const relevant = this.findRelevant(taskDescription, limit);
        if (relevant.length === 0) {
            return { summary: '', entries: [] };
        }
        // 构建反思摘要
        const lines = ['[Self-Reflection from past similar tasks]'];
        for (const entry of relevant) {
            lines.push(`- Task: ${entry.taskDescription.slice(0, 80)}`);
            lines.push(`  Score: ${entry.score}/100 | ${entry.success ? 'SUCCESS' : 'FAILED'}`);
            if (entry.lessonsLearned.length > 0) {
                lines.push(`  Lessons: ${entry.lessonsLearned.join('; ')}`);
            }
            if (entry.improvementPlan) {
                lines.push(`  Plan: ${entry.improvementPlan}`);
            }
        }
        // 如果有连续失败链，生成累积策略
        let chainedStrategy;
        const failures = relevant.filter(r => !r.success);
        if (failures.length >= 2) {
            const allLessons = failures.flatMap(f => f.lessonsLearned);
            const uniqueLessons = [...new Set(allLessons)];
            chainedStrategy = `CRITICAL: ${failures.length} previous failures detected. Key lessons: ${uniqueLessons.join('; ')}. Latest improvement plan: ${failures[0].improvementPlan}`;
            lines.push(`\n⚠️ ${chainedStrategy}`);
        }
        return {
            summary: lines.join('\n'),
            entries: relevant,
            chainedStrategy,
        };
    }
    // ─── 查询 ──────────────────────────────────────────────────────────────────
    getAll() {
        return [...this.entries];
    }
    getRecent(limit = 10) {
        return this.entries.slice(-limit);
    }
    getByTaskId(taskId) {
        return this.entries.find(e => e.taskId === taskId);
    }
    getStats() {
        const total = this.entries.length;
        if (total === 0) {
            return { totalReflections: 0, avgScore: 0, successRate: 0, topLessons: [] };
        }
        const avgScore = this.entries.reduce((s, e) => s + e.score, 0) / total;
        const successRate = this.entries.filter(e => e.success).length / total;
        // 统计最常出现的 lessons
        const lessonCount = new Map();
        for (const entry of this.entries) {
            for (const lesson of entry.lessonsLearned) {
                lessonCount.set(lesson, (lessonCount.get(lesson) || 0) + 1);
            }
        }
        const topLessons = Array.from(lessonCount.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([lesson]) => lesson);
        return { totalReflections: total, avgScore, successRate, topLessons };
    }
    // ─── 内部方法 ──────────────────────────────────────────────────────────────
    findRelevant(taskDescription, limit) {
        const words = taskDescription.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const scored = [];
        for (const entry of this.entries) {
            const text = entry.taskDescription.toLowerCase();
            let score = 0;
            for (const word of words) {
                if (text.includes(word))
                    score++;
            }
            // 时间衰减：越新的反思越相关
            const ageHours = (Date.now() - entry.timestamp) / (1000 * 60 * 60);
            const recencyBonus = Math.max(0, 1 - ageHours / (24 * 30)); // 30天内有加分
            score += recencyBonus * 0.5;
            if (score > 0.5) {
                scored.push({ entry, score });
            }
        }
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.entry);
    }
    getRecentFailures(taskDescription, limit) {
        return this.findRelevant(taskDescription, limit * 2)
            .filter(e => !e.success)
            .slice(0, limit);
    }
    fallbackReflection(outcome, recentFailures) {
        return {
            id: crypto_1.default.randomUUID(),
            taskId: outcome.taskId,
            taskDescription: outcome.taskDescription,
            success: outcome.success,
            score: outcome.success ? 70 : 30,
            whatWorked: outcome.success ? ['Task completed'] : [],
            whatFailed: outcome.success ? [] : ['Task did not complete successfully'],
            lessonsLearned: [],
            improvementPlan: outcome.success ? '' : 'Retry with more context',
            skillsUsed: outcome.skillsUsed || [],
            duration: outcome.duration,
            tokenUsage: outcome.tokenUsage,
            timestamp: Date.now(),
            previousReflexionId: recentFailures[0]?.id,
        };
    }
    trimOldEntries() {
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }
    }
    save() {
        fs_1.default.writeFileSync(path_1.default.join(this.storePath, 'reflexions.json'), JSON.stringify(this.entries, null, 2));
    }
    load() {
        const filePath = path_1.default.join(this.storePath, 'reflexions.json');
        if (!fs_1.default.existsSync(filePath))
            return;
        try {
            this.entries = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
        catch { /* start fresh */ }
    }
}
exports.Reflexion = Reflexion;
//# sourceMappingURL=reflexion.js.map