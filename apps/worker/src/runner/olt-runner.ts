import type { PrismaClient } from '@olt/db';
import type { OnuDetailJobData } from '@olt/shared/jobs';
import type { Job, Worker } from 'bullmq';
import { evaluateOlt } from '../alarms/alarm.engine.js';
import { onuDetailBackoff, processOnuDetail, type CliDeps } from '../cli/jobs/onu-detail.js';
import { processListSync } from '../cli/jobs/list-sync.js';
import { processUncfgScan } from '../cli/jobs/uncfg-scan.js';
import type { TelegramOutbox } from '../notify/telegram.outbox.js';
import { type IdentityProbeJobData, processIdentityProbe } from '../identity/probe.js';
import { POLL_YIELDED, type PollerDeps, PollYieldedError } from '../poller/context.js';
import { pollOptical } from '../poller/optical.js';
import { processWriteJob } from '../provision/provision.executor.js';
import type { ListSyncJobData, UncfgScanJobData, WriteJobData } from '@olt/shared/jobs';
import { type PollOutcome, pollStatus } from '../poller/status.js';
import { createOltWorker, OltQueues, type OltQueuesOptions, type PollJobName } from '../scheduler/olt-queues.js';

export interface RunnerLog {
  info(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface OltRunnerOptions extends OltQueuesOptions {
  deps: CliDeps & { prisma: PrismaClient };
  uiBaseUrl: string;
  outbox?: TelegramOutbox;
  reconcileMs?: number;
  outboxMs?: number;
  log: RunnerLog;
}

/** job.data of poll.status and poll.optical; the reruns queued by requeuePoll carry `rerun`. */
export interface PollJobData {
  oltId?: number;
  rerun?: boolean;
}

/** What runPoll needs from the queues: OltQueues, or a fake in tests. */
export interface PollQueues {
  hasUrgentJob(oltId: number): Promise<boolean>;
  requeuePoll(oltId: number, name: PollJobName): Promise<unknown>;
}

/**
 * One poll.status or poll.optical cycle (SPEC §6.4). A scheduled cycle gives way to an on-demand
 * job waiting in the OLT's queue (a click in the UI): it stops before its next SNMP column walk,
 * writes nothing, and is queued again to run right after that job. The rerun does not give way,
 * so a stream of clicks cannot starve the polls; a Redis error while checking never fails a poll.
 */
export async function runPoll(deps: PollerDeps, queues: PollQueues, oltId: number, name: PollJobName, data: PollJobData = {}): Promise<PollOutcome> {
  const checkpoint = async () => {
    if (await queues.hasUrgentJob(oltId).catch(() => false)) throw new PollYieldedError();
  };
  const opts = data.rerun ? {} : { checkpoint };
  const result = name === 'poll.status' ? await pollStatus(deps, oltId, opts) : await pollOptical(deps, oltId, opts);
  if (!result.ok && result.error === POLL_YIELDED) await queues.requeuePoll(oltId, name);
  return result;
}

/**
 * Wires the worker together: per-OLT schedulers and BullMQ workers follow the database
 * (re-checked every reconcileMs, so status changes made by the api are picked up), each poll
 * is followed by the alarm engine, and the Telegram outbox is flushed periodically.
 */
export class OltRunner {
  private readonly queues: OltQueues;
  private readonly workers = new Map<number, Worker>();
  private timers: NodeJS.Timeout[] = [];
  private reconciling: Promise<void> | undefined;

  constructor(private readonly opts: OltRunnerOptions) {
    this.queues = new OltQueues(opts);
    // Quarantine (and any other status change made inside the worker) takes effect at once:
    // schedulers go and queued jobs are dropped, instead of waiting for the next reconcile.
    opts.deps.uiBaseUrl ??= opts.uiBaseUrl;
    opts.deps.onOltStatusChanged = async (oltId) => {
      const olt = await opts.deps.prisma.olt.findUniqueOrThrow({ where: { id: oltId }, select: { id: true, status: true, statusIntervalS: true } });
      await this.queues.onOltChanged(olt);
      if (olt.status === 'quarantined') await (await this.queues.queue(oltId)).drain(true);
    };
  }

  async start(): Promise<void> {
    if (this.opts.outbox) {
      const recovered = await this.opts.outbox.recover();
      if (recovered) this.opts.log.info('outbox: interrupted notifications marked failed', { recovered });
    }
    await this.reconcile();
    this.timers.push(setInterval(() => void this.reconcile(), this.opts.reconcileMs ?? 15_000));
    if (this.opts.outbox) this.timers.push(setInterval(() => void this.flush(), this.opts.outboxMs ?? 5_000));
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
    await this.reconciling;
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    this.workers.clear();
    await this.queues.close();
  }

  /** Public for tests. */
  async reconcile(): Promise<void> {
    this.reconciling ??= (async () => {
      try {
        const olts = await this.opts.deps.prisma.olt.findMany({ select: { id: true, status: true, statusIntervalS: true } });
        await this.queues.reconcile(olts);
        const ids = new Set(olts.map((o) => o.id));
        for (const o of olts) if (!this.workers.has(o.id)) this.workers.set(o.id, this.worker(o.id));
        for (const [id, w] of this.workers) {
          if (ids.has(id)) continue;
          // Deleted by the api: this instance's worker stops first, then its queue is dropped.
          await w.close();
          this.workers.delete(id);
          await this.queues.forget(id);
        }
      } catch (error) {
        this.opts.log.error('reconcile failed', { error: (error as Error).name });
      } finally {
        this.reconciling = undefined;
      }
    })();
    return this.reconciling;
  }

  private worker(oltId: number): Worker {
    const deps = this.opts.deps;
    const w = createOltWorker(oltId, (job: Job) => this.process(oltId, job), {
      ...this.opts,
      settings: { backoffStrategy: onuDetailBackoff(deps.retryDelaysMs) },
    });
    w.on('failed', (job, err) => this.opts.log.error('job failed', { oltId, job: job?.name, error: err.name, ...('reason' in err && typeof err.reason === 'string' ? { reason: err.reason } : {}) }));
    return w;
  }

  private async process(oltId: number, job: Job): Promise<unknown> {
    const deps = this.opts.deps;
    switch (job.name) {
      case 'poll.status':
      case 'poll.optical': {
        const result = await runPoll(deps, this.queues, oltId, job.name, job.data as PollJobData);
        if (!result.ok && result.error === POLL_YIELDED) {
          // Nothing was written; the rerun that runPoll queued evaluates the alarms.
          this.opts.log.info('poll gave way to a waiting job', { oltId, job: job.name });
          return { ...result, alarms: null };
        }
        // A quarantined OLT has no fresh data: its ONU alarms stay as they were.
        const alarms = result.ok || result.oltStatus !== 'quarantined' ? await evaluateOlt({ prisma: deps.prisma, now: deps.now, uiBaseUrl: this.opts.uiBaseUrl }, oltId) : null;
        if (!result.ok) this.opts.log.info('poll failed', { oltId, job: job.name, error: result.error, oltStatus: result.oltStatus });
        return { ...result, alarms };
      }
      case 'cli.onu-detail':
        return processOnuDetail(deps, job as Job<OnuDetailJobData>);
      case 'cli.list-sync':
        return processListSync(deps, job as Job<ListSyncJobData>);
      case 'cli.uncfg-scan':
        return processUncfgScan(deps, job as Job<UncfgScanJobData>);
      case 'provision.onu-register':
      case 'config.save':
      case 'onu.reboot':
        return processWriteJob(deps, job as Job<WriteJobData>);
      case 'identity.probe':
        return processIdentityProbe(deps, job as Job<IdentityProbeJobData>);
      default:
        this.opts.log.error('unknown job', { oltId, job: job.name });
        return undefined;
    }
  }

  private async flush(): Promise<void> {
    try {
      // Drain: one merged message per call, until nothing is ready.
      for (let i = 0; i < 5; i++) {
        const r = await this.opts.outbox!.flush();
        if (r.sent === 0) break;
      }
    } catch (error) {
      this.opts.log.error('outbox flush failed', { error: (error as Error).name });
    }
  }
}
