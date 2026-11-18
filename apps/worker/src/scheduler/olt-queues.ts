import { JOB_PRIORITY, type OltJobName, oltQueueName } from '@olt/shared/jobs';
import { type ConnectionOptions, type JobsOptions, type Processor, Queue, Worker, type WorkerOptions } from 'bullmq';

// Hard rule 2: one BullMQ queue per OLT with *global* concurrency 1 (enforced in Redis, so it
// holds across every worker instance). Names and priorities live in @olt/shared/jobs.

export { JOB_PRIORITY, type OltJobName, oltQueueName } from '@olt/shared/jobs';

export type OltStatus = 'pending_pin' | 'ok' | 'stale' | 'unreachable' | 'quarantined' | 'disabled';

/** Statuses that are polled. pending_pin waits for a pin, quarantined for an admin, disabled forever. */
export const POLLED_STATUSES: ReadonlySet<OltStatus> = new Set(['ok', 'stale', 'unreachable']);

export const OPTICAL_INTERVAL_MS = 5 * 60_000;
export const NOTIFY_QUEUE = 'notify';
export const SCHEDULERS = ['poll.status', 'poll.optical'] as const;
export type PollJobName = (typeof SCHEDULERS)[number];

/** On-demand jobs (identity probe, CLI reads, Fase 2): a running poll gives way to them (SPEC §6.4). */
export const URGENT_PRIORITY = 1;


export interface OltScheduleInfo {
  id: number;
  status: OltStatus;
  statusIntervalS: number;
}

/** Spreads OLTs over the interval so polls never start together (SPEC §8.1). */
export const pollOffsetMs = (oltId: number, intervalMs: number) => (oltId * 7919) % intervalMs;

export interface OltQueuesOptions {
  connection: ConnectionOptions;
  /** Redis key prefix; tests use a unique one. */
  prefix?: string;
}

export class OltQueues {
  private readonly queues = new Map<number, Promise<Queue>>();
  readonly notify: Queue;

  constructor(private readonly options: OltQueuesOptions) {
    this.notify = new Queue(NOTIFY_QUEUE, this.queueOptions());
  }

  /** The OLT's queue, with global concurrency 1 set before first use. */
  queue(oltId: number): Promise<Queue> {
    let q = this.queues.get(oltId);
    if (!q) {
      const queue = new Queue(oltQueueName(oltId), this.queueOptions());
      q = queue.setGlobalConcurrency(1).then(() => queue);
      this.queues.set(oltId, q);
    }
    return q;
  }

  async add(oltId: number, name: OltJobName, data: Record<string, unknown>, opts: Omit<JobsOptions, 'priority'> = {}) {
    const queue = await this.queue(oltId);
    return queue.add(name, data, { removeOnComplete: 1000, removeOnFail: 5000, ...opts, priority: JOB_PRIORITY[name] });
  }

  /** True while an on-demand job waits for this OLT's queue. Delayed jobs (retry backoff) do not count. */
  async hasUrgentJob(oltId: number): Promise<boolean> {
    const counts = await (await this.queue(oltId)).getCountsPerPriority([URGENT_PRIORITY]);
    return (counts[String(URGENT_PRIORITY)] ?? 0) > 0;
  }

  /**
   * Queues a poll that gave way to an on-demand job again; by priority it runs right after that
   * job. The rerun is marked so it does not give way a second time, and at most one per OLT and
   * kind waits at once.
   */
  async requeuePoll(oltId: number, name: PollJobName) {
    return this.add(oltId, name, { oltId, rerun: true }, { deduplication: { id: `rerun:${name}:${oltId}` }, removeOnComplete: 100, removeOnFail: 500 });
  }

  /** Brings the schedulers of every given OLT in line with its status. Idempotent. */
  async reconcile(olts: readonly OltScheduleInfo[]): Promise<void> {
    for (const olt of olts) await this.onOltChanged(olt);
  }

  /** Call on start and whenever an OLT's status or interval changes. */
  async onOltChanged(olt: OltScheduleInfo): Promise<void> {
    const queue = await this.queue(olt.id);
    if (!POLLED_STATUSES.has(olt.status)) {
      for (const id of SCHEDULERS) await queue.removeJobScheduler(id);
      return;
    }
    const statusMs = olt.statusIntervalS * 1000;
    const template = (name: OltJobName) => ({ name, data: { oltId: olt.id }, opts: { priority: JOB_PRIORITY[name], removeOnComplete: 100, removeOnFail: 500 } });
    await queue.upsertJobScheduler('poll.status', { every: statusMs, offset: pollOffsetMs(olt.id, statusMs) }, template('poll.status'));
    await queue.upsertJobScheduler('poll.optical', { every: OPTICAL_INTERVAL_MS, offset: pollOffsetMs(olt.id, OPTICAL_INTERVAL_MS) }, template('poll.optical'));
  }

  /**
   * Drops the queue of a deleted OLT. The api obliterates it before deleting the row, but a
   * reconcile that read the OLT just before may have re-created its schedulers in between;
   * without this they would keep adding jobs that no worker takes.
   */
  async forget(oltId: number): Promise<void> {
    const q = this.queues.get(oltId);
    if (!q) return;
    this.queues.delete(oltId);
    const queue = await q;
    try {
      for (const id of SCHEDULERS) await queue.removeJobScheduler(id);
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  }

  async schedulers(oltId: number) {
    return (await this.queue(oltId)).getJobSchedulers();
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map(async (q) => (await q).close()));
    await this.notify.close();
  }

  private queueOptions() {
    return { connection: this.options.connection, ...(this.options.prefix ? { prefix: this.options.prefix } : {}) };
  }
}

/** A worker for one OLT queue. Local concurrency 1 as well; the global limit is what counts. */
export function createOltWorker(oltId: number, processor: Processor, options: OltQueuesOptions & { concurrency?: number; settings?: WorkerOptions['settings'] }) {
  return new Worker(oltQueueName(oltId), processor, {
    connection: options.connection,
    concurrency: options.concurrency ?? 1,
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.prefix ? { prefix: options.prefix } : {}),
  });
}
