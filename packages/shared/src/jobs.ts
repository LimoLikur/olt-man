// Queue contract shared by api (producer) and worker (consumer). No BullMQ import here.

/** BullMQ forbids ':' in queue names, hence "olt-<id>" instead of SPEC §6.4's "olt:{id}". */
export const oltQueueName = (oltId: number) => `olt-${oltId}`;

/** SPEC §6.4. Every job gets an explicit priority (1 = highest). */
export const JOB_PRIORITY = {
  'identity.probe': 1,
  'cli.onu-detail': 1,
  'cli.list-sync': 1,
  'cli.uncfg-scan': 1,
  'provision.onu-register': 1,
  'config.save': 1,
  'onu.reboot': 1,
  'poll.status': 2,
  'poll.optical': 3,
  'poll.metrics': 4,
  'poll.traffic': 4,
  'cli.port-sweep': 5,
} as const;
export type OltJobName = keyof typeof JOB_PRIORITY;

/**
 * cli.list-sync: reads the lists registrations pick from (VLANs, T-CONT profiles) off the OLT.
 * One attempt, at most one per OLT per 30 s.
 */
export const listSyncDedupId = (oltId: number) => `list-sync:${oltId}`;

export interface ListSyncJobData {
  /** job table row */
  jobId: number;
  oltId: number;
}

export function listSyncJobOptions(oltId: number) {
  return { priority: JOB_PRIORITY['cli.list-sync'], deduplication: { id: listSyncDedupId(oltId), ttl: 30_000 }, attempts: 1, removeOnComplete: 100, removeOnFail: 100 };
}

/** cli.uncfg-scan: reads the OLT's unregistered ONUs. One attempt, at most one per OLT per 15 s. */
export const uncfgScanDedupId = (oltId: number) => `uncfg-scan:${oltId}`;

export interface UncfgScanJobData {
  /** job table row */
  jobId: number;
  oltId: number;
}

export function uncfgScanJobOptions(oltId: number) {
  return { priority: JOB_PRIORITY['cli.uncfg-scan'], deduplication: { id: uncfgScanDedupId(oltId), ttl: 15_000 }, attempts: 1, removeOnComplete: 100, removeOnFail: 100 };
}

/** cli.onu-detail: retry delays for failing to get a session (SPEC §8.3), throttle per ONU. */
export const ONU_DETAIL_RETRY_MS = [30_000, 120_000, 300_000];
export const ONU_DETAIL_THROTTLE_MS = 30_000;
export const onuDetailDedupId = (onuId: number) => `onu-detail:${onuId}`;

export interface OnuDetailJobData {
  /** job table row */
  jobId: number;
  oltId: number;
  onuId: number;
}

/** BullMQ JobsOptions for cli.onu-detail (plain object, typed by the caller). */
export function onuDetailJobOptions(onuId: number, retryDelaysMs: number[] = ONU_DETAIL_RETRY_MS) {
  return {
    priority: JOB_PRIORITY['cli.onu-detail'],
    deduplication: { id: onuDetailDedupId(onuId), ttl: ONU_DETAIL_THROTTLE_MS },
    attempts: retryDelaysMs.length + 1,
    backoff: { type: 'onu-detail' },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** Fase 2 jobs: never retried once a command may have been sent (SPEC §8.3). */
export interface WriteJobData {
  /** job table row */
  jobId: number;
  oltId: number;
}
export type WriteJobName = 'provision.onu-register' | 'config.save' | 'onu.reboot';
export const writeJobId = (jobId: number) => `write-${jobId}`;
export const writeJobOptions = (jobId: number, name: WriteJobName) => ({
  jobId: writeJobId(jobId),
  priority: JOB_PRIORITY[name],
  attempts: 1,
  removeOnComplete: 1000,
  removeOnFail: 5000,
});
