import { Controller, ForbiddenException, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../common/request.js';
import { PRISMA } from '../common/tokens.js';
import { IdParam, iso } from '../common/validation.js';

@Controller('jobs')
export class JobsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Admin, the user who requested it (SPEC §6.5), or NOC for ONU registrations (they approve them). */
  @Roles('admin', 'noc', 'teknisi')
  @Get(':id')
  async get(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException();
    const nocReview = user.role === 'noc' && job.kind === 'onu_register';
    if (user.role !== 'admin' && job.requestedBy !== user.id && !nocReview) throw new ForbiddenException();
    return {
      id: job.id,
      oltId: job.oltId,
      kind: job.kind,
      status: job.status,
      params: job.params,
      preview: job.preview,
      previewSha256: job.previewSha256,
      result: job.result,
      appliedCommands: job.appliedCommands,
      requestedBy: job.requestedBy,
      createdAt: iso(job.createdAt),
      updatedAt: iso(job.updatedAt),
    };
  }
}
