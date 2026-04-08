"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw');
const CONFIG_FILE = path_1.default.join(CONFIG_DIR, 'config.json');
const DEFAULTS = {
    hubUrl: 'http://localhost:3100',
    callbackUrl: undefined,
    port: 19000,
    reportCron: '0 8 * * *',
    workspaceDir: path_1.default.join(os_1.default.homedir(), '.openclaw', 'workspace'),
    visibility: {
        shareMemory: true,
        shareTasks: true,
        redactPatterns: [],
    },
    ai: {
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
        authToken: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '',
        model: 'claude-sonnet-4-6',
        maxMemoryEntries: 20,
        cacheProbeInterval: 24 * 60 * 60 * 1000,
    },
    llm: {
        defaultProvider: 'anthropic',
        fallbackChain: ['openai', 'deepseek', 'groq', 'ollama'],
        providers: {
            anthropic: {
                enabled: true,
                apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '',
                baseUrl: process.env.ANTHROPIC_BASE_URL,
                defaultModel: 'claude-sonnet-4-6',
            },
            openai: {
                enabled: !!process.env.OPENAI_API_KEY,
                apiKey: process.env.OPENAI_API_KEY ?? '',
                defaultModel: 'gpt-4o-mini',
            },
            google: {
                enabled: !!process.env.GOOGLE_API_KEY,
                apiKey: process.env.GOOGLE_API_KEY ?? '',
                defaultModel: 'gemini-2.0-flash',
            },
            deepseek: {
                enabled: !!process.env.DEEPSEEK_API_KEY,
                apiKey: process.env.DEEPSEEK_API_KEY ?? '',
                defaultModel: 'deepseek-chat',
            },
            groq: {
                enabled: !!process.env.GROQ_API_KEY,
                apiKey: process.env.GROQ_API_KEY ?? '',
                defaultModel: 'llama-3.3-70b-versatile',
            },
            ollama: {
                enabled: false,
                apiKey: '',
                baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
                defaultModel: 'llama3',
            },
            // ── 国内模型 ──
            qwen: {
                enabled: !!process.env.QWEN_API_KEY,
                apiKey: process.env.QWEN_API_KEY ?? '',
                defaultModel: 'qwen-plus',
            },
            ernie: {
                enabled: !!process.env.ERNIE_API_KEY,
                apiKey: process.env.ERNIE_API_KEY ?? '',
                defaultModel: 'ernie-4.5-turbo',
            },
            hunyuan: {
                enabled: !!process.env.HUNYUAN_API_KEY,
                apiKey: process.env.HUNYUAN_API_KEY ?? '',
                defaultModel: 'hunyuan-turbo',
            },
            spark: {
                enabled: !!process.env.SPARK_API_KEY,
                apiKey: process.env.SPARK_API_KEY ?? '',
                defaultModel: 'generalv3.5',
            },
            kimi: {
                enabled: !!process.env.KIMI_API_KEY,
                apiKey: process.env.KIMI_API_KEY ?? '',
                defaultModel: 'moonshot-v1-32k',
            },
            zhipu: {
                enabled: !!process.env.ZHIPU_API_KEY,
                apiKey: process.env.ZHIPU_API_KEY ?? '',
                defaultModel: 'glm-4-flash',
            },
            baichuan: {
                enabled: !!process.env.BAICHUAN_API_KEY,
                apiKey: process.env.BAICHUAN_API_KEY ?? '',
                defaultModel: 'Baichuan4',
            },
        },
    },
};
function loadConfig() {
    let base;
    if (!fs_1.default.existsSync(CONFIG_FILE)) {
        // Write defaults so user can edit
        fs_1.default.mkdirSync(CONFIG_DIR, { recursive: true });
        fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2));
        console.log(`[config] Created default config at: ${CONFIG_FILE}`);
        base = { ...DEFAULTS };
    }
    else {
        const raw = fs_1.default.readFileSync(CONFIG_FILE, 'utf8');
        const user = JSON.parse(raw);
        base = {
            ...DEFAULTS,
            ...user,
            visibility: {
                ...DEFAULTS.visibility,
                ...(user.visibility ?? {}),
            },
            ai: {
                ...DEFAULTS.ai,
                ...(user.ai ?? {}),
            },
            llm: {
                ...DEFAULTS.llm,
                ...(user.llm ?? {}),
                providers: {
                    ...DEFAULTS.llm.providers,
                    ...(user.llm?.providers ?? {}),
                },
            },
        };
    }
    // Allow env var overrides for testing / containerized deployments
    if (process.env['NODE_PORT'])
        base.port = parseInt(process.env['NODE_PORT'], 10);
    if (process.env['PORT'])
        base.port = parseInt(process.env['PORT'], 10); // Railway injects PORT — takes highest priority
    if (process.env['JACKCLAW_HUB_URL'])
        base.hubUrl = process.env['JACKCLAW_HUB_URL'];
    if (process.env['JACKCLAW_NODE_ID'])
        base.nodeId = process.env['JACKCLAW_NODE_ID'];
    if (process.env['JACKCLAW_CALLBACK_URL'])
        base.callbackUrl = process.env['JACKCLAW_CALLBACK_URL'];
    return base;
}
//# sourceMappingURL=config.js.map