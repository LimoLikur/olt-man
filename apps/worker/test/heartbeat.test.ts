import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HeartbeatModule } from '../src/heartbeat/heartbeat.module.js';

describe('HeartbeatService', () => {
  it('writes a fresh timestamp on init', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hb-')), 'hb');
    const moduleRef = await Test.createTestingModule({
      imports: [HeartbeatModule.register({ file, intervalMs: 60_000 })],
    }).compile();
    await moduleRef.init();

    expect(Date.now() - Number(readFileSync(file, 'utf8'))).toBeLessThan(1000);
    await moduleRef.close();
  });
});
