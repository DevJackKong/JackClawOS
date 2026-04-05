import { Application, Request, Response, NextFunction, RequestHandler } from 'express';
import { JWTPayload } from './types';
export declare const JWT_SECRET: string;
interface HubKeys {
    publicKey: string;
    privateKey: string;
}
export declare function getHubKeys(): HubKeys;
/**
 * Wraps an async route handler so unhandled promise rejections
 * are forwarded to the Express error middleware instead of crashing.
 */
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler;
declare global {
    namespace Express {
        interface Request {
            jwtPayload?: JWTPayload;
        }
    }
}
export declare function createServer(): Application;
export {};
//# sourceMappingURL=server.d.ts.map