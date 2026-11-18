import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@olt/db';
import { PRISMA } from '../common/tokens.js';

export interface AuditEntry {
  actor: number | null;
  action: string;
  target?: string;
  detail?: Prisma.InputJsonValue;
  ip?: string;
}

/** Append-only audit log (the app role cannot UPDATE/DELETE audit_log). Never pass secrets. */
@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async record(e: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actor: e.actor, action: e.action, target: e.target ?? null, ...(e.detail === undefined ? {} : { detail: e.detail }), ip: e.ip || null },
    });
  }
}
