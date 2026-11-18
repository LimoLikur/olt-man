import { Module } from '@nestjs/common';
import { AlarmsController } from './alarms/alarms.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { IdentityController } from './identity/identity.controller.js';
import { JobQueueService } from './jobs/job-queue.service.js';
import { JobsController } from './jobs/jobs.controller.js';
import { ProvisionController } from './jobs/provision.controller.js';
import { OltSummaryService } from './olts/olt-summary.service.js';
import { OltsController } from './olts/olts.controller.js';
import { OnusController } from './onus/onus.controller.js';

@Module({
  controllers: [DashboardController, OltsController, IdentityController, OnusController, AlarmsController, JobsController, ProvisionController],
  providers: [OltSummaryService, JobQueueService],
})
export class RestModule {}
