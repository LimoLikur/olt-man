import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOltWorker, JOB_PRIORITY, OltQueues, type OltScheduleInfo } from '../src/scheduler/olt-queues.js';

let redis: StartedRedisContainer;
let connection: { host: string; port: number };
beforeAll(async () => {
  redis = await new RedisContainer('redis:7.4-alpine').start();
  connection = { host: redis.getHost(), port: redis.getPort() };
}, 120_000);
afterAll(() => redis?.stop());

const fresh = () => ({ connection, prefix: `t-${randomUUID()}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('per-OLT queues', () => {
  it('two worker instances never run two jobs of one OLT at the same time', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    let active = 0;
    let maxActive = 0;
    let done = 0;
    const processor = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(40);
      active--;
      done++;
    };
    // Two "processes", each even allowing 5 local jobs: only the global limit holds them back.
    const workers = [createOltWorker(1, processor, { ...opts, concurrency: 5 }), createOltWorker(1, processor, { ...opts, concurrency: 5 })];
    for (let i = 0; i < 10; i++) await queues.add(1, 'cli.onu-detail', { i });
    while (done < 10) await sleep(20);
    expect(maxActive).toBe(1);
    await Promise.all(workers.map((w) => w.close()));
    await queues.close();
  });

  it('runs a waiting priority-1 job before an earlier priority-3 job', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    await queues.add(2, 'poll.optical', {});
    await queues.add(2, 'poll.status', {});
    await queues.add(2, 'identity.probe', {});
    const order: string[] = [];
    const worker = createOltWorker(2, async (job: Job) => void order.push(job.name), opts);
    while (order.length < 3) await sleep(20);
    expect(order).toEqual(['identity.probe', 'poll.status', 'poll.optical']);
    await worker.close();
    await queues.close();
  });

  it('hasUrgentJob: only an on-demand (priority 1) job waiting in that OLT queue counts', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    await queues.add(4, 'poll.status', {});
    await queues.add(4, 'poll.optical', {});
    await queues.add(4, 'cli.port-sweep', {});
    await queues.add(4, 'cli.onu-detail', {}, { delay: 60_000 }); // retry backoff: not waiting yet
    expect(await queues.hasUrgentJob(4)).toBe(false);
    await queues.add(4, 'cli.uncfg-scan', {});
    expect(await queues.hasUrgentJob(4)).toBe(true);
    expect(await queues.hasUrgentJob(5)).toBe(false);
    await queues.close();
  });

  it('requeuePoll: one marked rerun per OLT and kind, by priority', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    await queues.requeuePoll(6, 'poll.optical');
    await queues.requeuePoll(6, 'poll.optical'); // deduplicated while the first one waits
    await queues.requeuePoll(6, 'poll.status');
    const waiting = await (await queues.queue(6)).getPrioritized();
    expect(waiting.map((j) => [j.name, j.data, j.opts.priority])).toEqual([
      ['poll.status', { oltId: 6, rerun: true }, 2],
      ['poll.optical', { oltId: 6, rerun: true }, 3],
    ]);
    await queues.close();
  });

  it('assigns the SPEC priority to every job', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    for (const name of Object.keys(JOB_PRIORITY) as (keyof typeof JOB_PRIORITY)[]) {
      expect((await queues.add(3, name, {})).opts.priority).toBe(JOB_PRIORITY[name]);
    }
    await queues.close();
  });
});

describe('schedulers', () => {
  const olts: OltScheduleInfo[] = [
    { id: 10, status: 'ok', statusIntervalS: 60 },
    { id: 11, status: 'pending_pin', statusIntervalS: 60 },
    { id: 12, status: 'quarantined', statusIntervalS: 60 },
    { id: 13, status: 'disabled', statusIntervalS: 60 },
    { id: 14, status: 'unreachable', statusIntervalS: 30 },
  ];

  it('creates poll.status and poll.optical only for polled OLTs, with an offset per OLT', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    await queues.reconcile(olts);
    const ids = async (id: number) => (await queues.schedulers(id)).map((s) => s.key).sort();
    expect(await ids(10)).toEqual(['poll.optical', 'poll.status']);
    expect(await ids(14)).toEqual(['poll.optical', 'poll.status']);
    expect(await ids(11)).toEqual([]);
    expect(await ids(12)).toEqual([]);
    expect(await ids(13)).toEqual([]);
    const status = (await queues.schedulers(14)).find((s) => s.key === 'poll.status')!;
    expect(status.every).toBe(30_000);
    expect(status.template?.opts?.priority).toBe(2);
    await queues.close();
  });

  it('does not duplicate schedulers on restart', async () => {
    const opts = fresh();
    for (let restart = 0; restart < 3; restart++) {
      const queues = new OltQueues(opts);
      await queues.reconcile(olts);
      await queues.close();
    }
    const queues = new OltQueues(opts);
    expect(await queues.schedulers(10)).toHaveLength(2);
    await queues.close();
  });

  it('removes schedulers when an OLT leaves the polled states and restores them', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    await queues.onOltChanged({ id: 20, status: 'ok', statusIntervalS: 60 });
    expect(await queues.schedulers(20)).toHaveLength(2);
    await queues.onOltChanged({ id: 20, status: 'quarantined', statusIntervalS: 60 });
    expect(await queues.schedulers(20)).toHaveLength(0);
    await queues.onOltChanged({ id: 20, status: 'ok', statusIntervalS: 60 });
    expect(await queues.schedulers(20)).toHaveLength(2);
    await queues.close();
  });

  it('forget (OLT deleted) removes schedulers and jobs a stale reconcile re-created in Redis', async () => {
    const opts = fresh();
    const queues = new OltQueues(opts);
    await queues.onOltChanged({ id: 30, status: 'ok', statusIntervalS: 60 });
    await queues.add(30, 'cli.onu-detail', { oltId: 30 });
    await queues.forget(30);

    const other = new OltQueues(opts); // a fresh view of the same Redis keys
    expect(await other.schedulers(30)).toHaveLength(0);
    expect(await (await other.queue(30)).count()).toBe(0);
    await queues.forget(30); // idempotent, also for an id it never had
    await other.close();
    await queues.close();
  });
});
