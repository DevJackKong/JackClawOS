"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTodayMemory = readTodayMemory;
exports.buildDailyReport = buildDailyReport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Read today's memory file from the OpenClaw workspace.
 * Applies redact patterns before returning.
 */
function readTodayMemory(config) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const memFile = path_1.default.join(config.workspaceDir, 'memory', `${today}.md`);
    if (!fs_1.default.existsSync(memFile)) {
        return null;
    }
    let content = fs_1.default.readFileSync(memFile, 'utf8');
    // Apply redact patterns
    for (const pattern of config.visibility.redactPatterns) {
        try {
            const re = new RegExp(pattern, 'gi');
            content = content.replace(re, '[REDACTED]');
        }
        catch {
            console.warn(`[reporter] Invalid redact pattern: ${pattern}`);
        }
    }
    return content;
}
/**
 * Generate a daily report payload.
 * Respects visibility settings.
 */
function buildDailyReport(config) {
    if (!config.visibility.shareMemory) {
        return {
            summary: 'Memory sharing disabled by node config',
            period: 'daily',
            visibility: 'private',
            data: {},
        };
    }
    const memContent = readTodayMemory(config);
    if (!memContent) {
        return {
            summary: 'No memory file for today',
            period: 'daily',
            visibility: 'summary_only',
            data: { date: new Date().toISOString().slice(0, 10) },
        };
    }
    // Build a lightweight summary (first 500 chars + line count)
    const lines = memContent.split('\n');
    const preview = memContent.slice(0, 500);
    const summary = `${lines.length} lines recorded today. Preview: ${preview}...`;
    return {
        summary,
        period: 'daily',
        visibility: 'full',
        data: {
            date: new Date().toISOString().slice(0, 10),
            lineCount: lines.length,
            charCount: memContent.length,
            // Only send full content if visibility is 'full'
            content: memContent,
        },
    };
}
//# sourceMappingURL=reporter.js.map