import type { Request } from 'express';
import type { Role } from '@olt/db';

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  sessionHash: string;
}

export type AppRequest = Request & { user?: SessionUser };

/**
 * Client IP. main.ts sets `trust proxy` to exactly 1 hop (caddy), so req.ip is the address
 * caddy saw; X-Forwarded-For entries added by the client itself are ignored.
 */
export const clientIp = (req: Request): string => (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
