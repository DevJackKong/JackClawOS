import type { JackClawConfig } from './config';
import type { ReportPayload } from '@jackclaw/protocol';
/**
 * Read today's memory file from the OpenClaw workspace.
 * Applies redact patterns before returning.
 */
export declare function readTodayMemory(config: JackClawConfig): string | null;
/**
 * Generate a daily report payload.
 * Respects visibility settings.
 */
export declare function buildDailyReport(config: JackClawConfig): ReportPayload;
//# sourceMappingURL=reporter.d.ts.map