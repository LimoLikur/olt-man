import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { clientIp } from './request.js';

/**
 * One JSON line per request: method, path (no query string), status, client IP, duration.
 * Never bodies, cookies or headers. The IP proves there is no SNAT in front of caddy (§14 C2).
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      process.stdout.write(
        `${JSON.stringify({ msg: 'request', method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ip: clientIp(req), ms: Math.round(ms) })}\n`,
      );
    });
    next();
  }
}
