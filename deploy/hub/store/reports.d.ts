import { ReportEntry, DailyReports } from '../types';
export declare function saveReport(entry: ReportEntry): void;
export declare function getReports(nodeId: string, date?: string): DailyReports | null;
export declare function getAllNodeReportsForDate(date?: string): DailyReports[];
export declare function getLastReportEntry(nodeId: string): ReportEntry | null;
//# sourceMappingURL=reports.d.ts.map