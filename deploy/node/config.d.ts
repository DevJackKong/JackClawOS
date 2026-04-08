export interface LLMProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    enabled: boolean;
}
export interface JackClawConfig {
    nodeId?: string;
    nodeName?: string;
    nodeRole?: string;
    hubUrl: string;
    callbackUrl?: string;
    port: number;
    reportCron: string;
    workspaceDir: string;
    visibility: {
        shareMemory: boolean;
        shareTasks: boolean;
        redactPatterns: string[];
    };
    ai: {
        baseUrl: string;
        authToken: string;
        model: string;
        maxMemoryEntries: number;
        cacheProbeInterval: number;
    };
    /** Multi-model LLM providers (via @jackclaw/llm-gateway) */
    llm: {
        defaultProvider: string;
        fallbackChain: string[];
        providers: {
            openai?: LLMProviderConfig;
            anthropic?: LLMProviderConfig;
            google?: LLMProviderConfig;
            deepseek?: LLMProviderConfig;
            groq?: LLMProviderConfig;
            mistral?: LLMProviderConfig;
            together?: LLMProviderConfig;
            openrouter?: LLMProviderConfig;
            ollama?: LLMProviderConfig & {
                baseUrl: string;
            };
            qwen?: LLMProviderConfig;
            ernie?: LLMProviderConfig;
            hunyuan?: LLMProviderConfig;
            spark?: LLMProviderConfig;
            kimi?: LLMProviderConfig;
            zhipu?: LLMProviderConfig;
            baichuan?: LLMProviderConfig;
            [key: string]: LLMProviderConfig | undefined;
        };
    };
}
export declare function loadConfig(): JackClawConfig;
//# sourceMappingURL=config.d.ts.map