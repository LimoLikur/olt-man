import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTS_CHANNEL, RedisEventPublisher, type WorkerEvent } from '../src/events/publisher.js';

let redis: StartedRedisContainer;
beforeAll(async () => {
  redis = await new RedisContainer('redis:7.4-alpine').start();
}, 120_000);
afterAll(() => redis?.stop());

describe('RedisEventPublisher (poller events)', () => {
  it('publishes JSON events on the olt:events channel', async () => {
    const sub = new Redis(redis.getConnectionUrl());
    const pub = new Redis(redis.getConnectionUrl());
    await sub.subscribe(EVENTS_CHANNEL);
    const received = new Promise<WorkerEvent>((resolve) => sub.on('message', (_c, msg) => resolve(JSON.parse(msg) as WorkerEvent)));
    const event: WorkerEvent = { type: 'onu.state', oltId: 1, onuId: 7, from: 'working', to: 'los', ts: new Date(0).toISOString(), observedAfterGap: false };
    await new RedisEventPublisher(pub).publish(event);
    expect(await received).toEqual(event);
    sub.disconnect();
    pub.disconnect();
  });
});
