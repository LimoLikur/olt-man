import { ConflictException, Controller, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@olt/db';
import { onuRebootParamsSchema, previewSha256, rebootOnu, renderPreview } from '@olt/olt-spec';
import { metricsQuerySchema, onuQuerySchema, type OnuView } from '@olt/shared/dto';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { type AppRequest, clientIp, type SessionUser } from '../common/request.js';
import { CLOCK, type Clock, PRISMA } from '../common/tokens.js';
import { IdParam, iso, num, parse } from '../common/validation.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { assertWritable } from '../jobs/write-guard.js';

const onuInclude = { ponPort: true, state: true, olt: { select: { name: true, status: true } } } satisfies Prisma.OnuInclude;
type OnuRow = Prisma.OnuGetPayload<{ include: typeof onuInclude }>;

const view = (o: OnuRow): OnuView => ({
  id: o.id,
  oltId: o.oltId,
  oltName: o.olt.name,
  oltStatus: o.olt.status,
  slot: o.ponPort.slot,
  port: o.ponPort.port,
  onuIndex: o.onuIndex,
  name: o.name,
  description: o.description,
  sn: o.sn,
  type: o.type,
  phase: o.state?.phaseState ?? null,
  adminState: o.state?.adminState ?? null,
  rxDbm: num(o.state?.rxDbm),
  oltRxDbm: num(o.state?.oltRxDbm),
  lastChangeAt: iso(o.state?.lastChangeAt),
  updatedAt: iso(o.state?.updatedAt),
});

@Controller('onus')
export class OnusController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly jobs: JobQueueService,
    private readonly audit: AuditService,
  ) {}

  @Roles('admin', 'noc', 'teknisi')
  @Get()
  async list(@Query() query: unknown) {
    const q = parse(onuQuerySchema, query);
    const rx: Prisma.OnuStateWhereInput | undefined =
      q.rx === 'crit' ? { rxDbm: { lt: -27 } } : q.rx === 'warn' ? { rxDbm: { gte: -27, lt: -25 } } : q.rx === 'ok' ? { rxDbm: { gte: -25 } } : undefined;
    const index = q.q && /^\d{1,3}$/.test(q.q) ? Number(q.q) : undefined;
    const where: Prisma.OnuWhereInput = {
      archivedAt: null,
      removedAt: null,
      ...(q.oltId ? { oltId: q.oltId } : {}),
      ...(q.slot || q.port ? { ponPort: { ...(q.slot ? { slot: q.slot } : {}), ...(q.port ? { port: q.port } : {}) } } : {}),
      ...(q.phase || rx ? { state: { ...(q.phase ? { phaseState: q.phase } : {}), ...rx } } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sn: { contains: q.q.toUpperCase() } }, ...(index !== undefined ? [{ onuIndex: index }] : [])] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.onu.count({ where }),
      this.prisma.onu.findMany({ where, include: onuInclude, orderBy: [{ oltId: 'asc' }, { ponPort: { slot: 'asc' } }, { ponPort: { port: 'asc' } }, { onuIndex: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
    ]);
    return { total, page: q.page, limit: q.limit, items: rows.map(view) };
  }

  @Roles('admin', 'noc', 'teknisi')
  @Get(':id')
  async get(@Param('id', IdParam) id: number) {
    const onu = await this.prisma.onu.findUnique({ where: { id }, include: onuInclude });
    if (!onu) throw new NotFoundException();
    const lastDetail = await this.prisma.job.findFirst({ where: { kind: 'onu_detail', status: 'succeeded', params: { equals: { onuId: id } } }, orderBy: { id: 'desc' }, select: { id: true, updatedAt: true, result: true } });
    const detail = lastDetail ? { jobId: lastDetail.id, at: iso(lastDetail.updatedAt), ...((lastDetail.result as { detail?: object; attenuation?: object }) ?? {}) } : null;
    if (detail && 'transcript' in detail) delete (detail as { transcript?: unknown }).transcript;
    return { ...view(onu), archivedAt: iso(onu.archivedAt), removedAt: iso(onu.removedAt), lastDetail: detail };
  }

  @Roles('admin', 'noc', 'teknisi')
  @Get(':id/metrics')
  async metrics(@Param('id', IdParam) id: number, @Query() query: unknown) {
    const q = parse(metricsQuerySchema, query);
    const to = q.to ? new Date(q.to) : this.clock.now();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3600_000);
    const rows = await this.prisma.onuMetric.findMany({ where: { onuId: id, ts: { gte: from, lte: to } }, orderBy: { ts: 'asc' }, take: 5000 });
    return rows.map((m) => ({ ts: m.ts.toISOString(), rxDbm: num(m.rxDbm), oltRxDbm: num(m.oltRxDbm) }));
  }

  @Roles('admin', 'noc', 'teknisi')
  @Get(':id/events')
  async events(@Param('id', IdParam) id: number) {
    const rows = await this.prisma.onuEvent.findMany({ where: { onuId: id }, orderBy: { ts: 'desc' }, take: 200 });
    return rows.map((e) => ({ id: Number(e.id), ts: e.ts.toISOString(), kind: e.kind, from: e.fromState, to: e.toState, cause: e.cause, observedAfterGap: e.observedAfterGap }));
  }

  /** Queues cli.onu-detail. 409 while CLI is off for the OLT; 429 within 30 s of the last one. */
  @Roles('admin', 'noc', 'teknisi')
  @Post(':id/refresh')
  @HttpCode(202)
  async refresh(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const onu = await this.prisma.onu.findUnique({ where: { id }, include: { olt: { select: { id: true, cliEnabled: true, status: true } } } });
    if (!onu) throw new NotFoundException();
    if (!onu.olt.cliEnabled) throw new ConflictException('CLI belum aktif untuk OLT ini.');
    const jobId = await this.jobs.enqueueOnuDetail(onu.olt.id, id, user.id);
    if (jobId === null) throw new HttpException('Refresh ONU ini baru saja diminta; tunggu 30 detik.', 429);
    await this.audit.record({ actor: user.id, action: 'onu.refresh', target: `onu:${id}`, detail: { jobId }, ip: clientIp(req) });
    return { jobId };
  }

  /**
   * ONU reboot (SPEC §8.5, owner decision 2026-11-27): every role. Write guard 1, then the
   * olt-spec template for the ONU's position and SN, stored with its sha256 as a preview. It runs
   * once its owner confirms that hash (POST /jobs/:id/confirm); nothing reaches an OLT here.
   */
  @Roles('admin', 'noc', 'teknisi')
  @Post(':id/reboot')
  async reboot(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const onu = await this.prisma.onu.findUnique({ where: { id }, include: { ponPort: true, olt: { select: { status: true, cliEnabled: true } } } });
    if (!onu) throw new NotFoundException();
    if (onu.archivedAt || onu.removedAt) throw new ConflictException('ONU ini sudah tidak terdaftar di OLT.');
    assertWritable(onu.olt);
    const parsed = onuRebootParamsSchema.safeParse({ slot: onu.ponPort.slot, port: onu.ponPort.port, onuId: onu.onuIndex, sn: onu.sn });
    if (!parsed.success) throw new ConflictException('Posisi atau SN ONU ini tidak lolos validasi template reboot.');
    const params = parsed.data;
    // One at a time: a second reboot queued behind the first would only cut the customer off again.
    const queued = await this.prisma.job.findFirst({
      where: { oltId: onu.oltId, kind: 'onu_reboot', status: { in: ['confirmed', 'running'] }, params: { path: ['sn'], equals: params.sn } },
      select: { id: true },
    });
    if (queued) throw new ConflictException(`Reboot ONU ini sedang berjalan (job #${queued.id}).`);
    const preview = renderPreview(rebootOnu(params));
    const job = await this.prisma.job.create({ data: { oltId: onu.oltId, kind: 'onu_reboot', params, preview, previewSha256: previewSha256(preview), status: 'preview', requestedBy: user.id } });
    await this.audit.record({ actor: user.id, action: 'job.preview', target: `job:${job.id}`, detail: { oltId: onu.oltId, kind: 'onu_reboot', onu: id, params }, ip: clientIp(req) });
    return { id: job.id, status: job.status, params, preview, previewSha256: job.previewSha256 };
  }
}
