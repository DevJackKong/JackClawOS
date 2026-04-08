"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrustGraph = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const SCORE_DELTA = {
    "task-completed": 2, "task-approved": 3, "task-rejected": -5,
    "task-timeout": -2, "collab-started": 1, "collab-completed": 3,
    "manual-boost": 10, "manual-revoke": -50,
};
function scoreToLevel(score) {
    if (score >= 95)
        return "deep";
    if (score >= 80)
        return "trusted";
    if (score >= 50)
        return "colleague";
    if (score >= 20)
        return "contact";
    return "unknown";
}
class TrustGraph {
    nodeId;
    edges = new Map();
    storePath;
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.storePath = path_1.default.join(os_1.default.homedir(), ".jackclaw", "trust", nodeId);
        fs_1.default.mkdirSync(this.storePath, { recursive: true });
        this.load();
    }
    record(to, type, reason) {
        const key = `${this.nodeId}→${to}`;
        const edge = this.edges.get(key) ?? {
            from: this.nodeId, to, score: 50, level: "contact",
            interactions: 0, lastInteractedAt: Date.now(), history: [],
        };
        const delta = SCORE_DELTA[type];
        edge.score = Math.max(0, Math.min(100, edge.score + delta));
        edge.level = scoreToLevel(edge.score);
        edge.interactions++;
        edge.lastInteractedAt = Date.now();
        edge.history = [...edge.history.slice(-49), { type, delta, reason, timestamp: Date.now() }];
        this.edges.set(key, edge);
        this.save();
    }
    getEdge(to) {
        return this.edges.get(`${this.nodeId}→${to}`) ?? null;
    }
    getTrustLevel(to) {
        return this.getEdge(to)?.level ?? "unknown";
    }
    canAutoAccept(to) {
        const level = this.getTrustLevel(to);
        return level === "trusted" || level === "deep";
    }
    getTopTrusted(limit = 5) {
        return [...this.edges.values()]
            .filter(e => e.from === this.nodeId)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    export() {
        return [...this.edges.values()].filter(e => e.from === this.nodeId);
    }
    load() {
        try {
            const data = JSON.parse(fs_1.default.readFileSync(path_1.default.join(this.storePath, "graph.json"), "utf-8"));
            for (const e of data)
                this.edges.set(`${e.from}→${e.to}`, e);
        }
        catch { }
    }
    save() {
        fs_1.default.writeFileSync(path_1.default.join(this.storePath, "graph.json"), JSON.stringify([...this.edges.values()], null, 2));
    }
}
exports.TrustGraph = TrustGraph;
//# sourceMappingURL=trust-graph.js.map