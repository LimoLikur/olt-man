import type { Redis } from 'ioredis';

/** Redis channel the api relays to Socket.IO clients (SPEC §6.6). */
export const EVENTS_CHANNEL = 'olt:events';

export type WorkerEvent =
  | { type: 'olt.status'; oltId: number; from: string; to: string; ts: string }
  | { type: 'onu.state'; oltId: number; onuId: number; from: string | null; to: string; ts: string; observedAfterGap: boolean }
  | { type: 'onu.inventory'; oltId: number; onuId: number; kind: 'created' | 'device_replaced' | 'archived' | 'removed'; ts: string };

export interface EventPublisher {
  publish(event: WorkerEvent): Promise<void>;
}

export class RedisEventPublisher implements EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(event: WorkerEvent): Promise<void> {
    await this.redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
  }
}

export class MemoryEventPublisher implements EventPublisher {
  readonly events: WorkerEvent[] = [];

  async publish(event: WorkerEvent): Promise<void> {
    this.events.push(event);
  }
}
