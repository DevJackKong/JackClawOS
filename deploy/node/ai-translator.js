"use strict";
/**
 * JackClaw AI Translator
 *
 * 实时翻译社交消息，支持中英日韩四语言。
 * - detectLanguage: 基于字符范围检测，不依赖 LLM
 * - translate: 调用 AiClient LLM 翻译
 * - LRU cache 1000 条，避免重复翻译
 * - 配置持久化到 ~/.jackclaw/node/translator.json
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiTranslator = void 0;
exports.getTranslator = getTranslator;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// ── 配置 ──────────────────────────────────────────────────────────────────────
const TRANSLATOR_CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node');
const TRANSLATOR_CONFIG_FILE = path_1.default.join(TRANSLATOR_CONFIG_DIR, 'translator.json');
const DEFAULT_PREF = {
    ownerLanguage: 'auto',
    autoTranslate: false,
    showOriginal: true,
};
function loadPreference() {
    if (!fs_1.default.existsSync(TRANSLATOR_CONFIG_FILE))
        return { ...DEFAULT_PREF };
    try {
        const raw = fs_1.default.readFileSync(TRANSLATOR_CONFIG_FILE, 'utf8');
        return { ...DEFAULT_PREF, ...JSON.parse(raw) };
    }
    catch {
        return { ...DEFAULT_PREF };
    }
}
function savePreference(pref) {
    fs_1.default.mkdirSync(TRANSLATOR_CONFIG_DIR, { recursive: true });
    fs_1.default.writeFileSync(TRANSLATOR_CONFIG_FILE, JSON.stringify(pref, null, 2));
}
// ── 简单 LRU Cache ────────────────────────────────────────────────────────────
class LRUCache {
    maxSize;
    map = new Map();
    constructor(maxSize) {
        this.maxSize = maxSize;
    }
    get(key) {
        if (!this.map.has(key))
            return undefined;
        // 移到末尾（最近使用）
        const val = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, val);
        return val;
    }
    set(key, value) {
        if (this.map.has(key))
            this.map.delete(key);
        else if (this.map.size >= this.maxSize) {
            // 删除最旧的（第一个）
            this.map.delete(this.map.keys().next().value);
        }
        this.map.set(key, value);
    }
    get size() { return this.map.size; }
}
// ── AiTranslator ──────────────────────────────────────────────────────────────
class AiTranslator {
    aiClient;
    pref;
    // key = `${text}|${from}|${to}`
    cache = new LRUCache(1000);
    constructor(aiClient) {
        this.aiClient = aiClient;
        this.pref = loadPreference();
    }
    /**
     * 基于 Unicode 字符范围检测语言（不依赖 LLM）
     * 返回 'zh' | 'en' | 'ja' | 'ko' | 'unknown'
     */
    detectLanguage(text) {
        const clean = text.replace(/\s+/g, '');
        if (!clean)
            return 'unknown';
        let zh = 0, ja = 0, ko = 0, en = 0, total = 0;
        for (const ch of clean) {
            const cp = ch.codePointAt(0) ?? 0;
            total++;
            // CJK Unified Ideographs（中文/日文汉字）
            if (cp >= 0x4E00 && cp <= 0x9FFF) {
                zh++;
                continue;
            }
            // CJK Extension A
            if (cp >= 0x3400 && cp <= 0x4DBF) {
                zh++;
                continue;
            }
            // 日文平假名
            if (cp >= 0x3040 && cp <= 0x309F) {
                ja++;
                continue;
            }
            // 日文片假名
            if (cp >= 0x30A0 && cp <= 0x30FF) {
                ja++;
                continue;
            }
            // 韩文音节
            if (cp >= 0xAC00 && cp <= 0xD7A3) {
                ko++;
                continue;
            }
            // 韩文字母
            if (cp >= 0x1100 && cp <= 0x11FF) {
                ko++;
                continue;
            }
            // ASCII 字母
            if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) {
                en++;
                continue;
            }
        }
        if (total === 0)
            return 'unknown';
        // 日文：有平假名/片假名就判���为日文（即使混有汉字）
        if (ja / total > 0.05)
            return 'ja';
        // 韩文
        if (ko / total > 0.1)
            return 'ko';
        // 中文
        if (zh / total > 0.1)
            return 'zh';
        // 英文
        if (en / total > 0.3)
            return 'en';
        return 'unknown';
    }
    /**
     * 判断消息是否需要翻译
     * ownerLang: 主人的语言偏好（'auto' 表示自动检测）
     */
    shouldTranslate(msg, ownerLang) {
        if (!this.pref.autoTranslate)
            return false;
        const msgLang = this.detectLanguage(msg.content);
        if (msgLang === 'unknown')
            return false;
        if (ownerLang === 'auto') {
            // auto 模式：如果检测到是中文，不翻译（默认主人是中文用户）
            return msgLang !== 'zh';
        }
        return msgLang !== ownerLang;
    }
    /**
     * 调用 LLM 翻译文本（带 LRU cache）
     */
    async translate(text, from, to) {
        if (from === to || from === 'unknown' || to === 'unknown')
            return text;
        const cacheKey = `${text}|${from}|${to}`;
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined)
            return cached;
        const langNames = {
            zh: '中文', en: 'English', ja: '日本語', ko: '한국어', unknown: '',
        };
        const result = await this.aiClient.call({
            systemPrompt: `You are a professional translator. Translate the given text to ${langNames[to]}. Output ONLY the translated text, no explanations, no quotation marks.`,
            messages: [
                { role: 'user', content: `Translate from ${langNames[from]} to ${langNames[to]}:\n${text}` },
            ],
            maxTokens: 1024,
        });
        const translated = result.content.trim();
        this.cache.set(cacheKey, translated);
        return translated;
    }
    /**
     * 翻译社交消息并附加原文（根据 showOriginal 配置）
     * 返回 TranslatedMessage，调用方决定如何展示
     */
    async translateMessage(msg) {
        const ownerLang = this.pref.ownerLanguage;
        const resolveLang = ownerLang === 'auto' ? 'zh' : ownerLang;
        if (!this.shouldTranslate(msg, ownerLang))
            return null;
        const fromLang = this.detectLanguage(msg.content);
        const toLang = resolveLang;
        const translated = await this.translate(msg.content, fromLang, toLang);
        const combined = this.pref.showOriginal
            ? `${translated}\n\n[原文 / Original]\n${msg.content}`
            : translated;
        return {
            original: msg.content,
            translated,
            fromLang,
            toLang,
            combined,
        };
    }
    /** 设置翻译偏好（内存 + 持久化） */
    setPreference(pref) {
        this.pref = { ...this.pref, ...pref };
        savePreference(this.pref);
    }
    getPreference() {
        return { ...this.pref };
    }
    /** 重新加载配置文件（运行时配置热更新） */
    reloadPreference() {
        this.pref = loadPreference();
    }
    get cacheSize() {
        return this.cache.size;
    }
}
exports.AiTranslator = AiTranslator;
// ── 单例工厂 ──────────────────────────────────────────────────────────────────
let _translator = null;
function getTranslator(aiClient) {
    if (!_translator) {
        _translator = new AiTranslator(aiClient);
    }
    return _translator;
}
//# sourceMappingURL=ai-translator.js.map