/**
 * JackClaw AI Translator
 *
 * 实时翻译社交消息，支持中英日韩四语言。
 * - detectLanguage: 基于字符范围检测，不依赖 LLM
 * - translate: 调用 AiClient LLM 翻译
 * - LRU cache 1000 条，避免重复翻译
 * - 配置持久化到 ~/.jackclaw/node/translator.json
 */
import type { SocialMessage } from '@jackclaw/protocol';
import type { AiClient } from './ai-client';
export type Language = 'zh' | 'en' | 'ja' | 'ko' | 'unknown';
export interface TranslatorPreference {
    ownerLanguage: 'zh' | 'en' | 'ja' | 'ko' | 'auto';
    autoTranslate: boolean;
    showOriginal: boolean;
}
export interface TranslatedMessage {
    original: string;
    translated: string;
    fromLang: Language;
    toLang: Language;
    combined: string;
}
export declare class AiTranslator {
    private aiClient;
    private pref;
    private cache;
    constructor(aiClient: AiClient);
    /**
     * 基于 Unicode 字符范围检测语言（不依赖 LLM）
     * 返回 'zh' | 'en' | 'ja' | 'ko' | 'unknown'
     */
    detectLanguage(text: string): Language;
    /**
     * 判断消息是否需要翻译
     * ownerLang: 主人的语言偏好（'auto' 表示自动检测）
     */
    shouldTranslate(msg: SocialMessage, ownerLang: TranslatorPreference['ownerLanguage']): boolean;
    /**
     * 调用 LLM 翻译文本（带 LRU cache）
     */
    translate(text: string, from: Language, to: Language): Promise<string>;
    /**
     * 翻译社交消息并附加原文（根据 showOriginal 配置）
     * 返回 TranslatedMessage，调用方决定如何展示
     */
    translateMessage(msg: SocialMessage): Promise<TranslatedMessage | null>;
    /** 设置翻译偏好（内存 + 持久化） */
    setPreference(pref: Partial<TranslatorPreference>): void;
    getPreference(): TranslatorPreference;
    /** 重新加载配置文件（运行时配置热更新） */
    reloadPreference(): void;
    get cacheSize(): number;
}
export declare function getTranslator(aiClient: AiClient): AiTranslator;
//# sourceMappingURL=ai-translator.d.ts.map