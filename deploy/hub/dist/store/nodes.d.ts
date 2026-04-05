import { RegisteredNode } from '../types';
export declare function registerNode(node: Omit<RegisteredNode, 'registeredAt'>): RegisteredNode;
export declare function getNode(nodeId: string): RegisteredNode | undefined;
export declare function getAllNodes(): RegisteredNode[];
export declare function updateLastReport(nodeId: string): void;
export declare function nodeExists(nodeId: string): boolean;
export declare function deriveNodeId(publicKey: string): string;
//# sourceMappingURL=nodes.d.ts.map