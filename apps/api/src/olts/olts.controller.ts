import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OID_PROFILES } from '@olt/olt-spec';
import { z } from 'zod';
import type { PrismaClient } from '@olt/db';
import type { ApiEnv } from '@olt/shared';
import { createOltSchema, patchOltSchema } from '@olt/shared/dto';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { type AppRequest, clientIp, type SessionUser } from '../common/request.js';
import { API_CONFIG, PRISMA } from '../common/tokens.js';
import { IdParam, parse } from '../common/validation.js';
import { CredentialEncryptor } from '../crypto/credential.encryptor.js';
import { readFileSync } from 'node:fs';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { hasIdentityProblem, IDENTITY_ALARM, withoutIdentityProblem } from './olt-deletion.js';
import { OltSummaryService } from './olt-summary.service.js';

/** The user re-types the OLT name, as for accepting an identity change. */
const deleteOltSchema = z.strictObject({ confirmName: z.string().max(64) });

const IDENTITY_PROBLEM = 'Identitas OLT ini berubah dan belum diterima admin. Hanya admin (dari jaringan kantor) yang bisa menghapusnya.';

@Controller('olts')
export class OltsController {
  private readonly encryptor: CredentialEncryptor | undefined;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) config: ApiEnv,
    private readonly summaries: OltSummaryService,
    private readonly audit: AuditService,
    private readonly jobs: JobQueueService,
  ) {
    const pem = config.OLT_CRED_PUBLIC_KEY ?? (config.OLT_CRED_PUBLIC_KEY_FILE ? readFileSync(config.OLT_CRED_PUBLIC_KEY_FILE, 'utf8') : undefined);
    this.encryptor = pem ? new CredentialEncryptor(pem) : undefined;
  }

  @Roles('admin', 'noc', 'teknisi')
  @Get()
  list() {
    return this.summaries.list();
  }

  @Roles('admin', 'noc', 'teknisi')
  @Get(':id')
  async get(@Param('id', IdParam) id: number) {
    const [olt] = await this.summaries.list({ id });
    if (!olt) throw new NotFoundException();
    return olt;
  }

  /** Registers an OLT in pending_pin: nothing polls it before an admin or NOC pins its identity (H1). */
  @Roles('admin', 'noc')
  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const input = parse(createOltSchema, body);
    const encryptor = this.requireEncryptor();
    if (!input.isMock && !OID_PROFILES[input.oidProfile].verified) {
      throw new UnprocessableEntityException('Profil OID belum terverifikasi golden test; OLT asli belum bisa didaftarkan.');
    }
    if (await this.prisma.olt.findUnique({ where: { name: input.name }, select: { id: true } })) throw new HttpException('Nama OLT sudah dipakai.', 409);
    const olt = await this.prisma.olt.create({
      data: {
        name: input.name,
        mgmtIp: input.mgmtIp,
        isMock: input.isMock,
        oidProfile: input.oidProfile,
        mgmtPath: input.mgmtPath,
        snmpVersion: input.snmp.version,
        snmpCredEnc: new Uint8Array(encryptor.snmp(input.name, input.snmp)),
        cliEnabled: input.cli !== undefined,
        cliCredEnc: input.cli ? new Uint8Array(encryptor.cli(input.name, input.cli)) : null,
        sshAlgorithms: input.sshAlgorithms,
        statusIntervalS: input.statusIntervalS,
        status: 'pending_pin',
        ...(input.isMock ? { alarmSettings: { profile: 'mock-fast' } } : {}),
      },
      select: { id: true },
    });
    await this.jobs.enqueueIdentityProbe(olt.id, user.id);
    await this.audit.record({
      actor: user.id,
      action: 'olt.created',
      target: `olt:${olt.id}`,
      detail: { name: input.name, isMock: input.isMock, snmpVersion: input.snmp.version, cli: input.cli !== undefined, sshAlgorithms: input.sshAlgorithms },
      ip: clientIp(req),
    });
    return this.get(olt.id);
  }

  @Roles('admin')
  @Patch(':id')
  async patch(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const input = parse(patchOltSchema, body);
    const olt = await this.prisma.olt.findUnique({ where: { id }, select: { name: true, status: true, cliEnabled: true, cliCredEnc: true } });
    if (!olt) throw new NotFoundException();
    const cliOn = input.cliEnabled ?? olt.cliEnabled;
    if (cliOn && !input.cli && !olt.cliCredEnc) throw new BadRequestException('Isi username dan password CLI untuk mengaktifkan CLI.');
    const needsKey = input.snmp !== undefined || input.cli !== undefined;
    const encryptor = needsKey ? this.requireEncryptor() : undefined;
    await this.prisma.olt.update({
      where: { id },
      data: {
        ...(input.mgmtPath ? { mgmtPath: input.mgmtPath } : {}),
        ...(input.statusIntervalS ? { statusIntervalS: input.statusIntervalS } : {}),
        ...(input.cliEnabled !== undefined ? { cliEnabled: input.cliEnabled } : {}),
        ...(input.sshAlgorithms ? { sshAlgorithms: input.sshAlgorithms } : {}),
        ...(input.snmp ? { snmpVersion: input.snmp.version, snmpCredEnc: new Uint8Array(encryptor!.snmp(olt.name, input.snmp)) } : {}),
        ...(input.cli ? { cliCredEnc: new Uint8Array(encryptor!.cli(olt.name, input.cli)) } : {}),
        ...(input.disabled === true ? { status: 'disabled' } : {}),
        // Re-enabling goes through the identity check again.
        ...(input.disabled === false && olt.status === 'disabled' ? { status: 'pending_pin' } : {}),
      },
    });
    const changed = Object.keys(input).map((k) => (k === 'snmp' || k === 'cli' ? `${k}_credentials` : k));
    // CLI just switched on, or new SSH algorithms: the host key can be (re)read now. Pinned
    // values are only confirmed by that probe; a different one quarantines the OLT.
    const probeSsh = cliOn && (!olt.cliEnabled || input.sshAlgorithms !== undefined);
    const status = input.disabled === true ? 'disabled' : input.disabled === false && olt.status === 'disabled' ? 'pending_pin' : olt.status;
    const probeJobId = probeSsh && status !== 'quarantined' && status !== 'disabled' ? await this.jobs.enqueueIdentityProbe(id, user.id) : undefined;
    await this.audit.record({
      actor: user.id,
      action: 'olt.updated',
      target: `olt:${id}`,
      detail: { changed, ...(input.sshAlgorithms ? { sshAlgorithms: input.sshAlgorithms } : {}), ...(probeJobId ? { probeJobId } : {}) },
      ip: clientIp(req),
    });
    return this.get(id);
  }

  /**
   * Deletes an OLT in any status, together with everything stored for it: ONUs and their
   * history, metrics, alarms, jobs and identity pins. Only the audit log and security events
   * (olt_id set null) remain, and nothing is sent to the OLT itself. Admin or NOC re-types the
   * name; an OLT with an unaccepted identity change is admin-only (hasIdentityProblem).
   */
  @Roles('admin', 'noc')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const input = parse(deleteOltSchema, body);
    const olt = await this.prisma.olt.findUnique({
      where: { id },
      select: {
        name: true,
        mgmtIp: true,
        isMock: true,
        status: true,
        identities: { where: { status: 'pinned' }, select: { kind: true, value: true } },
        _count: { select: { onus: true, alarms: true, jobs: true } },
      },
    });
    if (!olt) throw new NotFoundException();
    if (input.confirmName !== olt.name) throw new BadRequestException('Nama OLT tidak cocok.');
    // NOC: not while the identity is in question (admins accept or reject that change).
    const restricted = user.role !== 'admin';
    if (restricted && hasIdentityProblem(olt.status, await this.prisma.alarm.count({ where: { oltId: id, ...IDENTITY_ALARM } }))) throw new ForbiddenException(IDENTITY_PROBLEM);
    // Schedulers and waiting jobs go first; a job that is running (a poll, a CLI job) is never cut off.
    if (!(await this.jobs.removeOltQueue(id))) throw new ConflictException('Ada job yang sedang berjalan untuk OLT ini. Coba lagi beberapa detik lagi.');
    const { count } = await this.prisma.olt.deleteMany({ where: restricted ? withoutIdentityProblem(id) : { id } });
    if (count === 0) {
      if (await this.prisma.olt.findUnique({ where: { id }, select: { id: true } })) throw new ForbiddenException(IDENTITY_PROBLEM);
      throw new NotFoundException();
    }
    await this.audit.record({
      actor: user.id,
      action: 'olt.deleted',
      target: `olt:${id}`,
      // The pins go with the OLT; the audit keeps them, so a later re-registration can be compared.
      detail: { name: olt.name, mgmtIp: olt.mgmtIp, isMock: olt.isMock, status: olt.status, onus: olt._count.onus, alarms: olt._count.alarms, jobs: olt._count.jobs, pinned: olt.identities },
      ip: clientIp(req),
    });
  }

  private requireEncryptor(): CredentialEncryptor {
    if (!this.encryptor) throw new ServiceUnavailableException('OLT_CRED_PUBLIC_KEY belum dikonfigurasi.');
    return this.encryptor;
  }
}
