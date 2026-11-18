import type { Request, Response } from 'express';
import { SESSION_COOKIE } from './session.service.js';

export function readSessionCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

/** httpOnly + Secure + SameSite=Strict, scoped to the API. */
export function setSessionCookie(res: Response, id: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE, id, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: maxAgeMs });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
}
