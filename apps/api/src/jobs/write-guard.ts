import { ConflictException } from '@nestjs/common';
import type { WriteJobName } from '@olt/shared/jobs';

/** Write guard 1 (SPEC §8.5): the OLT is polled fine and has CLI on; the worker checks the rest. */
export function assertWritable(olt: { status: string; cliEnabled: boolean }): void {
  if (olt.status !== 'ok') throw new ConflictException(`OLT berstatus ${olt.status}; Fase 2 ditunda.`);
  if (!olt.cliEnabled) throw new ConflictException('CLI belum aktif untuk OLT ini.');
}

/** Job kinds that change an OLT (preview, hash, confirmation; SPEC §8.5) and their queue job. */
export const WRITE_JOB_NAME = { onu_register: 'provision.onu-register', config_save: 'config.save', onu_reboot: 'onu.reboot' } as const satisfies Record<string, WriteJobName>;
export type WriteJobKind = keyof typeof WRITE_JOB_NAME;
export const isWriteJobKind = (kind: string): kind is WriteJobKind => Object.hasOwn(WRITE_JOB_NAME, kind);
