"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNodeGateway = createNodeGateway;
exports.getNodeGateway = getNodeGateway;
const llm_gateway_1 = require("@jackclaw/llm-gateway");
let _gateway = null;
function createNodeGateway(config) {
    if (_gateway)
        return _gateway;
    const providers = [];
    const llm = config.llm;
    for (const [name, pc] of Object.entries(llm.providers)) {
        if (!pc || !pc.enabled)
            continue;
        // Ollama special: no apiKey needed
        if (name === 'ollama') {
            providers.push({
                provider: 'ollama',
                baseUrl: pc.baseUrl ?? 'http://localhost:11434',
                defaultModel: pc.defaultModel ?? 'llama3',
            });
            continue;
        }
        if (!pc.apiKey)
            continue; // skip unconfigured
        const entry = {
            provider: name,
            apiKey: pc.apiKey,
            defaultModel: pc.defaultModel,
        };
        if (pc.baseUrl)
            entry.baseUrl = pc.baseUrl;
        // Special base URLs for known providers
        if (name === 'deepseek' && !pc.baseUrl)
            entry.baseUrl = 'https://api.deepseek.com';
        if (name === 'groq' && !pc.baseUrl)
            entry.baseUrl = 'https://api.groq.com/openai';
        if (name === 'mistral' && !pc.baseUrl)
            entry.baseUrl = 'https://api.mistral.ai';
        if (name === 'together' && !pc.baseUrl)
            entry.baseUrl = 'https://api.together.xyz';
        if (name === 'openrouter' && !pc.baseUrl)
            entry.baseUrl = 'https://openrouter.ai/api';
        providers.push(entry);
    }
    if (!providers.length) {
        // Fallback: use the legacy ai config (single Anthropic-compatible endpoint)
        providers.push({
            provider: 'anthropic',
            apiKey: config.ai.authToken,
            baseUrl: config.ai.baseUrl,
            defaultModel: config.ai.model,
        });
    }
    const gwConfig = {
        providers,
        defaultProvider: llm.defaultProvider,
        fallbackChain: llm.fallbackChain.filter(p => providers.some(pr => pr.provider === p)),
    };
    _gateway = new llm_gateway_1.LLMGateway(gwConfig);
    const active = providers.map(p => p.provider).join(', ');
    console.log(`[llm-gateway] Active providers: ${active}`);
    console.log(`[llm-gateway] Default: ${llm.defaultProvider} · Fallback: ${gwConfig.fallbackChain?.join(' → ')}`);
    return _gateway;
}
function getNodeGateway() {
    return _gateway;
}
//# sourceMappingURL=llm-gateway.js.map