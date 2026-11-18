import { type DynamicModule, Module } from '@nestjs/common';
import { type HeartbeatOptions, HeartbeatService } from './heartbeat.service.js';

@Module({})
export class HeartbeatModule {
  static register(options: HeartbeatOptions): DynamicModule {
    return {
      module: HeartbeatModule,
      providers: [{ provide: HeartbeatService, useFactory: () => new HeartbeatService(options) }],
    };
  }
}
