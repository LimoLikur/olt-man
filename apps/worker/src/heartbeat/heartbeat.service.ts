import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { writeFileSync } from 'node:fs';

export interface HeartbeatOptions {
  file: string;
  intervalMs: number;
}

/** Touches a file periodically; the container healthcheck fails when it goes stale. */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: HeartbeatOptions) {}

  onModuleInit(): void {
    this.beat();
    this.timer = setInterval(() => this.beat(), this.options.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  beat(): void {
    writeFileSync(this.options.file, String(Date.now()));
  }
}
