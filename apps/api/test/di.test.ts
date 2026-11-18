import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { testConfig } from './helpers.js';

@Injectable()
class Clock {
  now(): number {
    return 42;
  }
}

// No @Inject(): resolution relies solely on emitted design:paramtypes metadata.
@Injectable()
class Greeter {
  constructor(private readonly clock: Clock) {}
  stamp(): number {
    return this.clock.now();
  }
}

describe('NestJS DI under Vitest', () => {
  it('emits decorator metadata (SWC)', () => {
    expect(Reflect.getMetadata('design:paramtypes', Greeter)).toEqual([Clock]);
  });

  it('resolves a service with a constructor dependency', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testConfig())],
      providers: [Clock, Greeter],
    }).compile();

    expect(moduleRef.get(Greeter).stamp()).toBe(42);
    await moduleRef.close();
  });
});
