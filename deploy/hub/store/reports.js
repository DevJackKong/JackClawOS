"use strict";
// JackClaw Hub - Report Store
// Persists to ~/.jackclaw/hub/reports/[nodeId]/[date].json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveReport = saveReport;
exports.getReports = getReports;
exports.getAllNodeReportsForDate = getAllNodeReportsForDate;
exports.getLastReportEntry = getLastReportEntry;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const REPORTS_BASE = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub', 'reports');
function getReportPath(nodeId, date) {
    return path_1.default.join(REPORTS_BASE, nodeId, `${date}.json`);
}
function ensureDir(nodeId) {
    fs_1.default.mkdirSync(path_1.default.join(REPORTS_BASE, nodeId), { recursive: true });
}
function todayDate() {
    return new Date().toISOString().slice(0, 10);
}
function saveReport(entry) {
    const date = new Date(entry.timestamp).toISOString().slice(0, 10);
    ensureDir(entry.nodeId);
    const filePath = getReportPath(entry.nodeId, date);
    let daily;
    if (fs_1.default.existsSync(filePath)) {
        try {
            daily = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
        catch {
            daily = { date, nodeId: entry.nodeId, reports: [] };
        }
    }
    else {
        daily = { date, nodeId: entry.nodeId, reports: [] };
    }
    daily.reports.push(entry);
    fs_1.default.writeFileSync(filePath, JSON.stringify(daily, null, 2), 'utf-8');
}
function getReports(nodeId, date) {
    const d = date ?? todayDate();
    const filePath = getReportPath(nodeId, d);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function getAllNodeReportsForDate(date) {
    const d = date ?? todayDate();
    const results = [];
    if (!fs_1.default.existsSync(REPORTS_BASE))
        return results;
    const nodeDirs = fs_1.default.readdirSync(REPORTS_BASE, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    for (const nodeId of nodeDirs) {
        const filePath = getReportPath(nodeId, d);
        if (fs_1.default.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
                results.push(data);
            }
            catch {
                // skip corrupt files
            }
        }
    }
    return results;
}
function getLastReportEntry(nodeId) {
    // Scan last 7 days for most recent report
    for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const daily = getReports(nodeId, d);
        if (daily && daily.reports.length > 0) {
            return daily.reports[daily.reports.length - 1];
        }
    }
    return null;
}
//# sourceMappingURL=reports.js.map