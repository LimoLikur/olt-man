import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import type { ApiEnv } from '@olt/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { SessionUser } from '../common/request.js';
import { API_CONFIG, CLOCK, type Clock, PRISMA } from '../common/tokens.js';

export const SESSION_COOKIE = 'olt_session';
export const hashSessionId = (id: string) => createHash('sha256').update(id).digest('hex');

/**
 * Server-side sessions (SPEC §8.6): the cookie holds a random ID, the table only its sha256.
 * Idle timeout and absolute lifetime come from env; a password change revokes the others.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiEnv,
  ) {}

  async create(userId: number, ip: string, userAgent: string | undefined): Promise<{ id: string; expiresAt: Date }> {
    const id = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.SESSION_MAX_HOURS * 3600_000);
    await this.prisma.session.create({
      data: { idHash: hashSessionId(id), userId, ip, userAgent: userAgent?.slice(0, 512) ?? null, createdAt: now, lastSeenAt: now, expiresAt },
    });
    return { id, expiresAt };
  }

  /** Valid session -> its user, and lastSeenAt is bumped. Anything else -> null. */
  async resolve(id: string | undefined): Promise<SessionUser | null> {
    if (!id || id.length > 100) return null;
    const idHash = hashSessionId(id);
    const s = await this.prisma.session.findUnique({ where: { idHash }, include: { user: true } });
    const now = this.clock.now();
    if (!s || s.revokedAt || !s.user.active) return null;
    const idleMs = this.config.SESSION_IDLE_MINUTES * 60_000;
    if (now >= s.expiresAt || now.getTime() - s.lastSeenAt.getTime() > idleMs || s.user.passwordChangedAt > s.createdAt) {
      await this.revoke(idHash);
      return null;
    }
    await this.prisma.session.update({ where: { idHash }, data: { lastSeenAt: now } });
    return { id: s.user.id, username: s.user.username, role: s.user.role, sessionHash: idHash };
  }

  async revoke(idHash: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { idHash, revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  async revokeOthers(userId: number, keepHash: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({ where: { userId, revokedAt: null, idHash: { not: keepHash } }, data: { revokedAt: this.clock.now() } });
    return count;
  }

  cookieMaxAgeMs(): number {
    return this.config.SESSION_MAX_HOURS * 3600_000;
  }
}
