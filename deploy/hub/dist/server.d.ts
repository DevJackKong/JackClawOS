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
/**
 * Sign a JWT using RS256 with the Hub's RSA private key.
 * All new tokens should be issued via this function.
 */
export declare function signJWT(payload: object, expiresIn?: string | number): string;
/**
 * Verify a JWT. Tries RS256 (Hub public key) first, then falls back to
 * HS256 legacy secrets for tokens issued before the RS256 migration.
 * Returns the decoded payload or null if invalid.
 */
export declare function verifyJWT(token: string): JWTPayload | null;
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