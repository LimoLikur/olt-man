export const API_CONFIG = Symbol('API_CONFIG');
export const PRISMA = Symbol('PRISMA');
export const REDIS = Symbol('REDIS');
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
