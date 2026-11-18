import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../common/tokens.js';

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_S = 15 * 60;

/**
 * Failed logins per client IP and per username in Redis (SPEC §8.6); the 6th attempt within
 * the window is refused (429).
 */
@Injectable()
export class LoginRateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private keys(ip: string, username?: string) {
    return [`rl:login:ip:${ip}`, ...(username ? [`rl:login:user:${username.toLowerCase().slice(0, 64)}`] : [])];
  }

  async blocked(ip: string, username?: string): Promise<boolean> {
    const counts = await this.redis.mget(...this.keys(ip, username));
    return counts.some((c) => Number(c ?? 0) >= LOGIN_MAX_FAILURES);
  }

  async fail(ip: string, username: string): Promise<void> {
    for (const key of this.keys(ip, username)) {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, LOGIN_WINDOW_S);
    }
  }

  /** On success only the IP counter is reset: a username under attack stays protected. */
  async reset(ip: string): Promise<void> {
    await this.redis.del(...this.keys(ip));
  }
}
