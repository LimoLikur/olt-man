import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { type AppRequest, clientIp, type SessionUser } from '../common/request.js';
import { CLOCK, type Clock, PRISMA } from '../common/tokens.js';
import { IdParam, iso, parse } from '../common/validation.js';
import { JobQueueService } from '../jobs/job-queue.service.js';

const acceptSchema = z.strictObject({
  reason: z.string().trim().min(5, 'alasan wajib').max(500),
  /** The admin re-types the OLT name to confirm (SPEC §8.4 step 5). */
  confirmName: z.string().max(64),
});

/** OLT identity: candidates, pins and accepting a change (SPEC §6.5, §8.4). */
@Controller('olts/:id/identity')
export class IdentityController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly jobs: JobQueueService,
    private readonly audit: AuditService,
  ) {}

  @Roles('admin', 'noc')
  @Get()
  async get(@Param('id', IdParam) id: number) {
    const olt = await this.prisma.olt.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
    if (!olt) throw new NotFoundException();
    const rows = await this.prisma.oltIdentity.findMany({ where: { oltId: id }, orderBy: { id: 'desc' } });
    const lastProbe = await this.prisma.job.findFirst({ where: { oltId: id, kind: 'identity_probe' }, orderBy: { id: 'desc' }, select: { id: true, status: true, result: true, updatedAt: true } });
    const view = (r: (typeof rows)[number]) => ({ id: r.id, kind: r.kind, value: r.value, algo: r.algo, label: r.label, reason: r.reason, pinnedAt: iso(r.pinnedAt), createdAt: iso(r.createdAt) });
    return {
      olt,
      pinned: rows.filter((r) => r.status === 'pinned').map(view),
      candidates: rows.filter((r) => r.status === 'candidate').map(view),
      retired: rows.filter((r) => r.status === 'retired').map(view),
      lastProbe: lastProbe ? { ...lastProbe, updatedAt: iso(lastProbe.updatedAt) } : null,
    };
  }

  /** Re-probe (not while quarantined: no SNMP/CLI then, CLAUDE.md rule 7). Admin or NOC. */
  @Roles('admin', 'noc')
  @Post('probe')
  @HttpCode(202)
  async probe(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const olt = await this.prisma.olt.findUnique({ where: { id }, select: { status: true } });
    if (!olt) throw new NotFoundException();
    if (olt.status === 'quarantined') throw new ConflictException('OLT dikarantina: terima atau tolak perubahan identitas dulu.');
    const jobId = await this.jobs.enqueueIdentityProbe(id, user.id);
    await this.audit.record({ actor: user.id, action: 'olt.identity_probe', target: `olt:${id}`, detail: { jobId }, ip: clientIp(req) });
    return { jobId };
  }

  /**
   * Pins the current candidates; pending_pin -> ok once SNMP identity is pinned (polling starts).
   * Admin or NOC (owner decision 2026-11-10). Replacing a pin stays admin-only (accept-change).
   */
  @Roles('admin', 'noc')
  @Post('pin')
  @HttpCode(200)
  async pin(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const olt = await this.prisma.olt.findUnique({ where: { id }, include: { identities: true } });
    if (!olt) throw new NotFoundException();
    if (olt.status === 'quarantined') throw new ConflictException('OLT dikarantina: gunakan "terima perubahan".');
    // "pin" only adds kinds that were never pinned. Replacing a pinned value is an identity
    // change: quarantine, then accept-change with a reason (SPEC §8.4 steps 4-5). Leftover
    // candidates equal to a pin (older probes) are dropped.
    const pins = olt.identities.filter((i) => i.status === 'pinned');
    const all = olt.identities.filter((i) => i.status === 'candidate');
    const stale = all.filter((c) => pins.some((p) => p.kind === c.kind && p.value === c.value));
    const candidates = all.filter((c) => !stale.includes(c));
    if (stale.length) await this.prisma.oltIdentity.deleteMany({ where: { id: { in: stale.map((c) => c.id) }, status: 'candidate' } });
    if (candidates.length === 0) throw new ConflictException('Belum ada kandidat identitas baru. Jalankan probe dulu.');
    if (candidates.some((c) => pins.some((p) => p.kind === c.kind))) {
      throw new ConflictException('Kandidat berbeda dari identitas yang sudah di-pin. Perubahan identitas hanya lewat karantina dan "Terima perubahan".');
    }
    const pinned = await this.apply(id, user.id, candidates.map((c) => c.id), 'pin');
    await this.audit.record({ actor: user.id, action: 'olt.identity_pinned', target: `olt:${id}`, detail: { pinned }, ip: clientIp(req) });
    return this.get(id);
  }

  /** SPEC §8.4 step 5: reason + retyped OLT name; old values retired, new ones pinned, polling resumes. */
  @Roles('admin')
  @Post('accept-change')
  @HttpCode(200)
  async acceptChange(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const input = parse(acceptSchema, body);
    const olt = await this.prisma.olt.findUnique({ where: { id }, include: { identities: true } });
    if (!olt) throw new NotFoundException();
    if (olt.status !== 'quarantined') throw new ConflictException('OLT tidak dalam karantina.');
    if (input.confirmName !== olt.name) throw new BadRequestException('Nama OLT tidak cocok.');
    const candidates = olt.identities.filter((i) => i.status === 'candidate');
    const pinned = await this.apply(id, user.id, candidates.map((c) => c.id), input.reason);
    await this.prisma.alarm.updateMany({ where: { oltId: id, kind: 'olt_identity_mismatch', state: 'active' }, data: { state: 'cleared', clearedAt: this.clock.now() } });
    await this.audit.record({ actor: user.id, action: 'olt.identity_change_accepted', target: `olt:${id}`, detail: { reason: input.reason, pinned }, ip: clientIp(req) });
    return this.get(id);
  }

  /** Pins candidate ids (retiring pins of the same kind) and moves the OLT out of pending_pin/quarantined. */
  private async apply(oltId: number, userId: number, ids: number[], reason: string) {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.oltIdentity.findMany({ where: { id: { in: ids }, oltId, status: 'candidate' } });
      for (const r of rows) {
        await tx.oltIdentity.updateMany({ where: { oltId, kind: r.kind, status: 'pinned' }, data: { status: 'retired', reason: `replaced: ${reason}`.slice(0, 512) } });
        await tx.oltIdentity.update({ where: { id: r.id }, data: { status: 'pinned', pinnedBy: userId, pinnedAt: now, reason: reason.slice(0, 512) } });
      }
      const pinnedKinds = new Set((await tx.oltIdentity.findMany({ where: { oltId, status: 'pinned' }, select: { kind: true } })).map((r) => r.kind));
      const olt = await tx.olt.findUniqueOrThrow({ where: { id: oltId } });
      const snmpPinned = pinnedKinds.has(olt.snmpVersion === 'v3' ? 'snmp_engine_id' : 'snmp_sysinfo');
      if (snmpPinned && (olt.status === 'pending_pin' || olt.status === 'quarantined')) await tx.olt.update({ where: { id: oltId }, data: { status: 'ok' } });
      return rows.map((r) => ({ kind: r.kind, value: r.value }));
    });
  }
}
