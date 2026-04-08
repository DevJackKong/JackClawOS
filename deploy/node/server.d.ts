import type { NodeIdentity, TaskPayload } from '@jackclaw/protocol';
import type { JackClawConfig } from './config';
import type { NodeChatClient } from './chat-client';
export type HarnessRunner = (opts: {
    taskId: string;
    title: string;
    description: string;
    workdir: string;
    requireApproval: boolean;
}) => Promise<{
    status: string;
    attempts: number;
}>;
export declare function registerHarnessRunner(runner: HarnessRunner): void;
export declare function createServer(identity: NodeIdentity, config: JackClawConfig, chatClient?: NodeChatClient): import("express-serve-static-core").Express;
export declare function handleTask(task: TaskPayload, identity: NodeIdentity, config: JackClawConfig): void;
//# sourceMappingURL=server.d.ts.map