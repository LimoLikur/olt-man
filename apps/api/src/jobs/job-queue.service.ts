import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import type { ApiEnv } from '@olt/shared';
import {
  JOB_PRIORITY,
  onuDetailDedupId,
  onuDetailJobOptions,
  type OnuDetailJobData,
  oltQueueName,
  listSyncDedupId,
  type ListSyncJobData,
  listSyncJobOptions,
  uncfgScanDedupId,
  type UncfgScanJobData,
  uncfgScanJobOptions,
  type WriteJobData,
  type WriteJobName,
  writeJobId,
  writeJobOptions,
} from '@olt/shared/jobs';
import { Queue } from 'bullmq';
import { API_CONFIG, PRISMA } from '../common/tokens.js';

/** The api only produces jobs (CLAUDE.md rule 1); the worker owns the queues' settings. */
@Injectable()
export class JobQueueService implements OnApplicationShutdown {
  private readonly queues = new Map<number, Queue>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiEnv,
  ) {}

  private queue(oltId: number): Queue {
    let q = this.queues.get(oltId);
    if (!q) {
      q = new Queue(oltQueueName(oltId), { connection: { url: this.config.REDIS_URL } });
      this.queues.set(oltId, q);
    }
    return q;
  }

  /** job row + BullMQ job; null when throttled (one per ONU per 30 s). */
  async enqueueOnuDetail(oltId: number, onuId: number, requestedBy: number): Promise<number | null> {
    const queue = this.queue(oltId);
    if (await queue.getDeduplicationJobId(onuDetailDedupId(onuId))) return null;
    const row = await this.prisma.job.create({ data: { oltId, kind: 'onu_detail', params: { onuId }, status: 'confirmed', requestedBy } });
    await queue.add('cli.onu-detail', { jobId: row.id, oltId, onuId } satisfies OnuDetailJobData, onuDetailJobOptions(onuId));
    return row.id;
  }

  /** cli.list-sync: read the OLT's VLANs and T-CONT profiles into its lists; null when throttled (30 s). */
  async enqueueListSync(oltId: number, requestedBy: number): Promise<number | null> {
    const queue = this.queue(oltId);
    if (await queue.getDeduplicationJobId(listSyncDedupId(oltId))) return null;
    const row = await this.prisma.job.create({ data: { oltId, kind: 'list_sync', params: {}, status: 'confirmed', requestedBy } });
    await queue.add('cli.list-sync', { jobId: row.id, oltId } satisfies ListSyncJobData, listSyncJobOptions(oltId));
    return row.id;
  }

  /** cli.uncfg-scan: read the OLT's unregistered ONUs; null when throttled (15 s). */
  async enqueueUncfgScan(oltId: number, requestedBy: number): Promise<number | null> {
    const queue = this.queue(oltId);
    if (await queue.getDeduplicationJobId(uncfgScanDedupId(oltId))) return null;
    const row = await this.prisma.job.create({ data: { oltId, kind: 'uncfg_scan', params: {}, status: 'confirmed', requestedBy } });
    await queue.add('cli.uncfg-scan', { jobId: row.id, oltId } satisfies UncfgScanJobData, uncfgScanJobOptions(oltId));
    return row.id;
  }

  /** identity.probe: on registration and on admin request (SPEC §6.4). */
  async enqueueIdentityProbe(oltId: number, requestedBy: number): Promise<number> {
    const row = await this.prisma.job.create({ data: { oltId, kind: 'identity_probe', params: {}, status: 'confirmed', requestedBy } });
    await this.queue(oltId).add('identity.probe', { jobId: row.id, oltId }, { priority: JOB_PRIORITY['identity.probe'], removeOnComplete: 100, removeOnFail: 100 });
    return row.id;
  }

  /** Confirmed Fase 2 job -> the OLT queue (the worker re-checks everything). */
  async enqueueWrite(oltId: number, jobId: number, name: WriteJobName): Promise<void> {
    await this.queue(oltId).add(name, { jobId, oltId } satisfies WriteJobData, writeJobOptions(jobId, name));
  }

  /** Removes a write job that has not started; returns false if it is already running. */
  async removeWrite(oltId: number, jobId: number): Promise<boolean> {
    const job = await this.queue(oltId).getJob(writeJobId(jobId));
    if (!job) return true;
    if (await job.isActive()) return false;
    await job.remove();
    return true;
  }

  /**
   * Drops the queue of an OLT about to be deleted, with its waiting probe jobs. Returns false while
   * a job is active: the worker may be talking to the OLT, so the delete waits for it to finish.
   */
  async removeOltQueue(oltId: number): Promise<boolean> {
    const queue = this.queue(oltId);
    if ((await queue.getActiveCount()) > 0) return false;
    try {
      await queue.obliterate();
    } catch (error) {
      // obliterate pauses first; a job that started meanwhile must not leave the queue stuck.
      await queue.resume();
      if ((error as Error).message.includes('active jobs')) return false;
      throw error;
    }
    await queue.close();
    this.queues.delete(oltId);
    return true;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
