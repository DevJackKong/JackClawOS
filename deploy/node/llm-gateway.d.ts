/**
 * createNodeGateway — Initialize LLM Gateway from Node config
 *
 * Reads enabled providers from config, returns a ready-to-use gateway.
 */
import type { JackClawConfig } from './config.js';
import { LLMGateway } from '@jackclaw/llm-gateway';
export declare function createNodeGateway(config: JackClawConfig): LLMGateway;
export declare function getNodeGateway(): LLMGateway | null;
//# sourceMappingURL=llm-gateway.d.ts.map