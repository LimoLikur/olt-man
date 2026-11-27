import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { checkProvisionMode, previewSha256, provisionParamsShape, registerOnuAndSave, renderPreview, tcontProfileSchema, vlanSchema, writeConfig } from '@olt/olt-spec';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { type AppRequest, clientIp, type SessionUser } from '../common/request.js';
import { PRISMA } from '../common/tokens.js';
import { IdParam, iso, parse } from '../common/validation.js';
import { JobQueueService } from './job-queue.service.js';
import { assertWritable, isWriteJobKind, WRITE_JOB_NAME, type WriteJobKind } from './write-guard.js';

/** Draft from the form; the ONU ID is chosen here, from the latest data. */
const confirmSchema = z.strictObject({ previewSha256: z.string().regex(/^[0-9a-f]{64}$/) });

const rejectSchema = z.strictObject({ reason: z.string().trim().min(5, 'alasan wajib').max(500) });

const addVlanSchema = z.strictObject({ vlan: vlanSchema });

const addTcontSchema = z.strictObject({ profile: tcontProfileSchema });

const CANCELLABLE = ['preview', 'pending_approval', 'confirmed'] as const;

/** The registration fields without the ONU ID (chosen here), with the same per-mode rule as the builder (SPEC §8.5). */
const draftSchema = provisionParamsShape
  .omit({ onuId: true })
  .extend({ oltId: z.number().int().positive(), kind: z.literal('onu_register').default('onu_register') })
  .superRefine(checkProvisionMode);

@Controller()
export class ProvisionController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly queue: JobQueueService,
  ) {}

  /**
   * preview -> confirmed (SPEC §8.5): the body carries the hash of the preview the user saw.
   * Admin: any Fase 2 job, runs at once. NOC and teknisi: an onu_reboot job they created, runs at
   * once (owner decision 2026-11-27). Teknisi also: an onu_register job they created (§14 B18),
   * which goes to pending_approval: NOC or admin approves it before it runs.
   */
  @Roles('admin', 'noc', 'teknisi')
  @Post('jobs/:id/confirm')
  @HttpCode(200)
  async confirm(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const { previewSha256: hash } = parse(confirmSchema, body);
    const job = await this.loadWriteJob(id);
    if (user.role !== 'admin') {
      const own = job.requestedBy === user.id;
      if (!own || !(job.kind === 'onu_reboot' || (user.role === 'teknisi' && job.kind === 'onu_register'))) throw new ForbiddenException();
    }
    if (job.status !== 'preview') throw new ConflictException(`job berstatus ${job.status}`);
    if (hash !== job.previewSha256) throw new ConflictException('Preview sudah berubah. Buat preview ulang.');
    if (user.role === 'teknisi' && job.kind === 'onu_register') {
      const { count } = await this.prisma.job.updateMany({ where: { id, status: 'preview' }, data: { status: 'pending_approval' } });
      if (count !== 1) throw new ConflictException('job sudah diajukan');
      await this.audit.record({ actor: user.id, action: 'job.submitted', target: `job:${id}`, detail: { previewSha256: hash }, ip: clientIp(req) });
      return { id, status: 'pending_approval' };
    }
    await this.start(job, 'preview', user.id);
    await this.audit.record({ actor: user.id, action: 'job.confirmed', target: `job:${id}`, detail: { previewSha256: hash }, ip: clientIp(req) });
    return { id, status: 'confirmed' };
  }

  /** NOC/admin: registrations waiting for approval, oldest first. */
  @Roles('admin', 'noc')
  @Get('approvals')
  async pendingApproval() {
    const jobs = await this.prisma.job.findMany({ where: { status: 'pending_approval' }, orderBy: { id: 'asc' }, include: { olt: { select: { name: true } } } });
    const users = await this.usernames(jobs.map((j) => j.requestedBy));
    return jobs.map((j) => ({
      id: j.id,
      oltId: j.oltId,
      oltName: j.olt.name,
      kind: j.kind,
      params: j.params,
      requestedBy: j.requestedBy ? (users.get(j.requestedBy) ?? null) : null,
      createdAt: iso(j.createdAt),
      submittedAt: iso(j.updatedAt),
    }));
  }

  /**
   * pending_approval -> confirmed: the approver sends the hash of the preview they reviewed, so
   * what runs is exactly what they saw. Nobody approves their own job.
   */
  @Roles('admin', 'noc')
  @Post('jobs/:id/approve')
  @HttpCode(200)
  async approve(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const { previewSha256: hash } = parse(confirmSchema, body);
    const job = await this.loadWriteJob(id);
    if (job.status !== 'pending_approval') throw new ConflictException(`job berstatus ${job.status}`);
    if (job.requestedBy === user.id) throw new ForbiddenException('Job sendiri tidak bisa disetujui sendiri.');
    if (hash !== job.previewSha256) throw new ConflictException('Preview sudah berubah. Muat ulang halaman.');
    await this.start(job, 'pending_approval', user.id);
    await this.audit.record({ actor: user.id, action: 'job.approved', target: `job:${id}`, detail: { previewSha256: hash, requestedBy: job.requestedBy }, ip: clientIp(req) });
    return { id, status: 'confirmed' };
  }

  /** pending_approval -> rejected, with a reason the teknisi sees on the job page. */
  @Roles('admin', 'noc')
  @Post('jobs/:id/reject')
  @HttpCode(200)
  async reject(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const { reason } = parse(rejectSchema, body);
    const job = await this.prisma.job.findUnique({ where: { id }, select: { status: true, requestedBy: true } });
    if (!job) throw new NotFoundException();
    if (job.status !== 'pending_approval') throw new ConflictException(`job berstatus ${job.status}`);
    const { count } = await this.prisma.job.updateMany({
      where: { id, status: 'pending_approval' },
      data: { status: 'rejected', confirmedBy: user.id, result: { error: 'rejected', rejectReason: reason, message: `Ditolak oleh ${user.username}: ${reason}` } },
    });
    if (count !== 1) throw new ConflictException('job sudah diproses');
    await this.audit.record({ actor: user.id, action: 'job.rejected', target: `job:${id}`, detail: { reason, requestedBy: job.requestedBy }, ip: clientIp(req) });
    return { id, status: 'rejected' };
  }

  /** Admin or the owner (NOC owns only its reboots), while the job has not started. */
  @Roles('admin', 'noc', 'teknisi')
  @Post('jobs/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException();
    if (user.role !== 'admin' && job.requestedBy !== user.id) throw new ForbiddenException();
    if (!CANCELLABLE.includes(job.status as (typeof CANCELLABLE)[number])) throw new ConflictException(`job berstatus ${job.status}`);
    if (job.status === 'confirmed' && !(await this.queue.removeWrite(job.oltId, id))) throw new ConflictException('job sudah berjalan');
    const { count } = await this.prisma.job.updateMany({ where: { id, status: { in: [...CANCELLABLE] } }, data: { status: 'cancelled' } });
    if (count !== 1) throw new ConflictException('job sudah berjalan');
    await this.audit.record({ actor: user.id, action: 'job.cancelled', target: `job:${id}`, ip: clientIp(req) });
    return { id, status: 'cancelled' };
  }

  /** A Fase 2 job (any OLT since 2026-11-13, CLAUDE.md rule 3). */
  private async loadWriteJob(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException();
    const { kind } = job;
    if (!isWriteJobKind(kind)) throw new BadRequestException('job ini tidak perlu konfirmasi');
    return { ...job, kind };
  }

  /** from -> confirmed (compare-and-set), then onto the OLT's queue. */
  private async start(job: { id: number; oltId: number; kind: WriteJobKind }, from: 'preview' | 'pending_approval', userId: number) {
    const { count } = await this.prisma.job.updateMany({ where: { id: job.id, status: from }, data: { status: 'confirmed', confirmedBy: userId } });
    if (count !== 1) throw new ConflictException('job sudah diproses');
    await this.queue.enqueueWrite(job.oltId, job.id, WRITE_JOB_NAME[job.kind]);
  }

  private async usernames(ids: (number | null)[]) {
    const rows = await this.prisma.user.findMany({ where: { id: { in: ids.filter((i): i is number => i !== null) } }, select: { id: true, username: true } });
    return new Map(rows.map((u) => [u.id, u.username]));
  }

  /**
   * config.save (SPEC §8.5): `write` saves the whole running-config, including changes made
   * outside this app. Admin, from the LAN; returns the preview to confirm like any write job.
   */
  @Roles('admin')
  @Post('olts/:id/save-config')
  async saveConfig(@Param('id', IdParam) oltId: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const olt = await this.prisma.olt.findUnique({ where: { id: oltId } });
    if (!olt) throw new NotFoundException();
    assertWritable(olt);
    const preview = renderPreview([writeConfig()]);
    const job = await this.prisma.job.create({ data: { oltId, kind: 'config_save', params: {}, preview, previewSha256: previewSha256(preview), status: 'preview', requestedBy: user.id } });
    await this.audit.record({ actor: user.id, action: 'job.preview', target: `job:${job.id}`, detail: { oltId, kind: 'config_save' }, ip: clientIp(req) });
    return { id: job.id, status: job.status, preview, previewSha256: job.previewSha256 };
  }

  /** Fase 2 changes not saved yet: succeeded onu_register jobs without saved_by_job_id. */
  @Roles('admin')
  @Get('olts/:id/unsaved-changes')
  async unsaved(@Param('id', IdParam) oltId: number) {
    const jobs = await this.prisma.job.findMany({ where: { oltId, kind: 'onu_register', status: 'succeeded', savedByJobId: null }, orderBy: { id: 'asc' } });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: jobs.map((j) => j.requestedBy ?? 0) } }, select: { id: true, username: true } })).map((u) => [u.id, u.username]));
    return jobs.map((j) => ({
      jobId: j.id,
      actor: j.requestedBy ? (users.get(j.requestedBy) ?? null) : null,
      at: iso(j.updatedAt),
      params: j.params,
      appliedCommands: j.appliedCommands,
      before: j.beforeSnapshot,
      after: j.afterSnapshot,
    }));
  }

  /**
   * Form options (SPEC §8.5): PON ports, the OLT's VLAN and T-CONT profile lists (the only
   * values a registration may use), and ONU types from provision_allowlist as suggestions.
   */
  @Roles('admin', 'teknisi')
  @Get('olts/:id/provision-options')
  async options(@Param('id', IdParam) id: number) {
    const olt = await this.prisma.olt.findUnique({ where: { id }, include: { allowlist: true, ponPorts: { orderBy: [{ slot: 'asc' }, { port: 'asc' }] } } });
    if (!olt) throw new NotFoundException();
    const values = (kind: string) => olt.allowlist.filter((a) => a.kind === kind).map((a) => a.value);
    return {
      oltId: olt.id,
      ready: olt.status === 'ok' && olt.cliEnabled,
      ports: olt.ponPorts.map((p) => ({ slot: p.slot, port: p.port })),
      onuTypes: values('onu_type'),
      tcontProfiles: values('tcont_profile').sort(),
      vlans: byNumber(values('vlan')),
    };
  }

  /**
   * Unregistered ONUs (SPEC §8.5): `{ scan }` with the latest `show gpon onu uncfg` scan of this
   * OLT, null before the first one. The registration page lists them per OLT.
   */
  @Roles('admin', 'noc', 'teknisi')
  @Get('olts/:id/uncfg')
  async uncfg(@Param('id', IdParam) id: number) {
    if (!(await this.prisma.olt.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException();
    const job = await this.prisma.job.findFirst({ where: { oltId: id, kind: 'uncfg_scan' }, orderBy: { id: 'desc' } });
    if (!job) return { scan: null };
    const result = (job.result ?? {}) as { onus?: unknown[]; error?: string };
    return { scan: { jobId: job.id, status: job.status, at: iso(job.updatedAt), onus: result.onus ?? [], error: result.error ?? null } };
  }

  /** Runs `show gpon onu uncfg` on the OLT (read-only), at most once per 15 s; audited. */
  @Roles('admin', 'noc', 'teknisi')
  @Post('olts/:id/uncfg/scan')
  @HttpCode(202)
  async scanUncfg(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const olt = await this.prisma.olt.findUnique({ where: { id }, select: { id: true, cliEnabled: true } });
    if (!olt) throw new NotFoundException();
    if (!olt.cliEnabled) throw new ConflictException('CLI belum aktif untuk OLT ini.');
    const jobId = await this.queue.enqueueUncfgScan(id, user.id);
    if (jobId === null) throw new HttpException('Scan ONU uncfg baru saja diminta; tunggu 15 detik.', 429);
    await this.audit.record({ actor: user.id, action: 'olt.uncfg_scan', target: `olt:${id}`, detail: { jobId }, ip: clientIp(req) });
    return { jobId };
  }

  /** The VLANs registrations may use on this OLT (SPEC §8.5). Kept in the app only. */
  @Roles('admin', 'noc', 'teknisi')
  @Get('olts/:id/vlans')
  async vlans(@Param('id', IdParam) id: number) {
    return byNumber(await this.listValues(id, 'vlan'));
  }

  /** The T-CONT profiles registrations may use on this OLT (SPEC §8.5). Kept in the app only. */
  @Roles('admin', 'noc', 'teknisi')
  @Get('olts/:id/tcont-profiles')
  async tcontProfiles(@Param('id', IdParam) id: number) {
    return (await this.listValues(id, 'tcont_profile')).sort();
  }

  /**
   * NOC and admin: read the VLANs and T-CONT profiles defined on the OLT (read-only `show`
   * commands) into its lists. The worker only adds; nothing already on a list is removed.
   */
  @Roles('admin', 'noc')
  @Post('olts/:id/provision-lists/sync')
  @HttpCode(202)
  async syncLists(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const olt = await this.prisma.olt.findUnique({ where: { id }, select: { id: true, cliEnabled: true } });
    if (!olt) throw new NotFoundException();
    if (!olt.cliEnabled) throw new ConflictException('CLI belum aktif untuk OLT ini.');
    const jobId = await this.queue.enqueueListSync(id, user.id);
    if (jobId === null) throw new HttpException('Pengambilan daftar dari OLT baru saja diminta; tunggu 30 detik.', 429);
    await this.audit.record({ actor: user.id, action: 'olt.lists_sync', target: `olt:${id}`, detail: { jobId }, ip: clientIp(req) });
    return { jobId };
  }

  /** NOC and admin add a VLAN to the OLT's list; the OLT itself is not changed (owner decision 2026-11-13). */
  @Roles('admin', 'noc')
  @Post('olts/:id/vlans')
  async addVlan(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const { vlan } = parse(addVlanSchema, body);
    await this.addValue(id, 'vlan', String(vlan), `VLAN ${vlan}`);
    await this.audit.record({ actor: user.id, action: 'olt.vlan_added', target: `olt:${id}`, detail: { vlan }, ip: clientIp(req) });
    return { vlan };
  }

  /** NOC and admin add a T-CONT profile name to the OLT's list; the OLT itself is not changed. */
  @Roles('admin', 'noc')
  @Post('olts/:id/tcont-profiles')
  async addTcontProfile(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const { profile } = parse(addTcontSchema, body);
    await this.addValue(id, 'tcont_profile', profile, `Profil T-CONT ${profile}`);
    await this.audit.record({ actor: user.id, action: 'olt.tcont_profile_added', target: `olt:${id}`, detail: { profile }, ip: clientIp(req) });
    return { profile };
  }

  private async listValues(oltId: number, kind: 'vlan' | 'tcont_profile') {
    if (!(await this.prisma.olt.findUnique({ where: { id: oltId }, select: { id: true } }))) throw new NotFoundException();
    return (await this.prisma.provisionAllowlist.findMany({ where: { oltId, kind }, select: { value: true } })).map((r) => r.value);
  }

  private async addValue(oltId: number, kind: 'vlan' | 'tcont_profile', value: string, label: string) {
    if (!(await this.prisma.olt.findUnique({ where: { id: oltId }, select: { id: true } }))) throw new NotFoundException();
    const { count } = await this.prisma.provisionAllowlist.createMany({ data: [{ oltId, kind, value }], skipDuplicates: true });
    if (count === 0) throw new ConflictException(`${label} sudah ada di daftar.`);
  }

  /**
   * draft -> preview (SPEC §8.5): write guard 1, allowlist, next free ONU ID, rendered by the
   * olt-spec builder in the template of the chosen mode (registration, then `write`), stored
   * with its sha256. Nothing reaches an OLT here.
   */
  @Roles('admin', 'teknisi')
  @Post('jobs')
  async create(@Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const ip = clientIp(req);
    const draft = parse(draftSchema, body);
    const olt = await this.prisma.olt.findUnique({ where: { id: draft.oltId } });
    if (!olt) throw new NotFoundException();
    assertWritable(olt);
    // The ONU type is typed in the form: its schema bounds it and the OLT refuses an unknown one
    // (job stops there). Every VLAN and T-CONT profile must be on the OLT's lists (2026-11-13),
    // the Bridge Static bridging pair included.
    const listed = [
      { kind: 'vlan' as const, value: String(draft.vlan), field: 'vlan', label: `VLAN ${draft.vlan}` },
      { kind: 'tcont_profile' as const, value: draft.tcontProfile, field: 'tcontProfile', label: `Profil T-CONT ${draft.tcontProfile}` },
      ...(draft.bridgeVlan === undefined ? [] : [{ kind: 'vlan' as const, value: String(draft.bridgeVlan), field: 'bridgeVlan', label: `VLAN ${draft.bridgeVlan}` }]),
      ...(draft.bridgeTcontProfile === undefined
        ? []
        : [{ kind: 'tcont_profile' as const, value: draft.bridgeTcontProfile, field: 'bridgeTcontProfile', label: `Profil T-CONT ${draft.bridgeTcontProfile}` }]),
    ];
    for (const l of listed) {
      if (!(await this.prisma.provisionAllowlist.findFirst({ where: { oltId: olt.id, kind: l.kind, value: l.value } }))) {
        throw new BadRequestException({ message: `${l.label} tidak ada di daftar OLT ini.`, fields: [l.field] });
      }
    }

    const port = await this.prisma.ponPort.findUnique({ where: { oltId_slot_port: { oltId: olt.id, slot: draft.slot, port: draft.port } } });
    if (!port) throw new BadRequestException({ message: 'port PON tidak ada di OLT ini', fields: ['slot', 'port'] });
    if (await this.prisma.onu.findFirst({ where: { oltId: olt.id, sn: draft.sn, archivedAt: null, removedAt: null } })) throw new ConflictException('SN sudah terdaftar di OLT ini.');
    const used = new Set((await this.prisma.onu.findMany({ where: { ponPortId: port.id, archivedAt: null, removedAt: null }, select: { onuIndex: true } })).map((o) => o.onuIndex));
    const onuId = Array.from({ length: 128 }, (_, i) => i + 1).find((n) => !used.has(n));
    if (!onuId) throw new ConflictException('Port PON penuh (128 ONU).');

    const params = {
      mode: draft.mode,
      slot: draft.slot,
      port: draft.port,
      onuId,
      sn: draft.sn,
      name: draft.name,
      onuType: draft.onuType,
      tcontProfile: draft.tcontProfile,
      vlan: draft.vlan,
      // Mode-specific fields: the draft schema refuses them in the modes that do not use them.
      ...(draft.description === undefined ? {} : { description: draft.description }),
      ...(draft.lanPorts === undefined ? {} : { lanPorts: draft.lanPorts }),
      // Bridge Static: the bridging service on T-CONT 2 and vport 2 (owner decision 2026-11-17).
      ...(draft.bridgeTcontProfile === undefined ? {} : { bridgeTcontProfile: draft.bridgeTcontProfile }),
      ...(draft.bridgeVlan === undefined ? {} : { bridgeVlan: draft.bridgeVlan }),
      // PPPoE MAP: stored and previewed as typed (owner decision 2026-11-15).
      ...(draft.pppoeUsername === undefined ? {} : { pppoeUsername: draft.pppoeUsername }),
      ...(draft.pppoePassword === undefined ? {} : { pppoePassword: draft.pppoePassword }),
    };
    const preview = renderPreview(registerOnuAndSave(params));
    const job = await this.prisma.job.create({
      data: { oltId: olt.id, kind: 'onu_register', params, preview, previewSha256: previewSha256(preview), status: 'preview', requestedBy: user.id },
    });
    await this.audit.record({ actor: user.id, action: 'job.preview', target: `job:${job.id}`, detail: { oltId: olt.id, params }, ip });
    return { id: job.id, status: job.status, params, preview, previewSha256: job.previewSha256, createdAt: iso(job.createdAt) };
  }
}

/** VLAN values (stored as text) as numbers, ascending. */
const byNumber = (values: string[]) => values.map(Number).sort((a, b) => a - b);
