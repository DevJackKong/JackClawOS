/**
 * JackClaw Built-in Tool Definitions
 *
 * 权限分级：
 * - L0/L1: webSearch, readUrl, mathCalc
 * - L2:    + fileRead, runCode
 * - L3:    + fileWrite, shellExec
 */
export interface ToolParameter {
    type: string;
    description: string;
    enum?: string[];
    items?: {
        type: string;
    };
    required?: boolean;
}
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ToolParameter>;
        required: string[];
    };
    permissionLevel: 0 | 1 | 2 | 3;
    execute: (args: Record<string, unknown>) => Promise<string>;
}
export interface ToolCallResult {
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    error?: string;
    durationMs: number;
}
export declare const ALL_TOOLS: ToolDefinition[];
export declare function getToolsForLevel(level: 0 | 1 | 2 | 3): ToolDefinition[];
export declare function getToolByName(name: string): ToolDefinition | undefined;
export declare function executeTool(name: string, args: Record<string, unknown>, permissionLevel?: 0 | 1 | 2 | 3): Promise<ToolCallResult>;
//# sourceMappingURL=index.d.ts.map