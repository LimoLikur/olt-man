import { type AllowedCommand, ParseError, parseTcontProfiles, parseVlanSummary, showTcontProfiles, showVlanSummary, tcontProfileSchema } from '@olt/olt-spec';
import type { ListSyncJobData } from '@olt/shared/jobs';
import type { Job } from 'bullmq';
import type { CliDeps } from './onu-detail.js';
import { ReadJobFailure, runReadJob } from './read-job.js';

/** A list registrations pick from, read off the OLT: one read command, its parser, its allowlist kind. */
interface OltList {
  key: 'vlans' | 'tcontProfiles';
  kind: 'vlan' | 'tcont_profile';
  command: () => AllowedCommand;
  /** values to store, and values found but unusable in a template (reported, not stored) */
  parse: (raw: string) => { values: string[]; skipped: string[] };
}

const LISTS: readonly OltList[] = [
  { key: 'vlans', kind: 'vlan', command: showVlanSummary, parse: (raw) => ({ values: parseVlanSummary(raw).vlans.map(String), skipped: [] }) },
  {
    key: 'tcontProfiles',
    kind: 'tcont_profile',
    command: showTcontProfiles,
    parse: (raw) => {
      const names = parseTcontProfiles(raw).profiles.map((p) => p.name);
      const usable = (n: string) => tcontProfileSchema.safeParse(n).success;
      return { values: names.filter(usable), skipped: names.filter((n) => !usable(n)) };
    },
  },
];

/**
 * cli.list-sync (SPEC §8.5): in one read session, reads each list (VLANs, T-CONT profiles) and
 * adds what it finds to the OLT's lists. It only adds: values added by NOC/admin, or gone from
 * the OLT since, stay. A list whose output does not parse is skipped (its raw output is kept
 * for the parser fix) and fails the job; the other lists are still saved. One attempt.
 */
export async function processListSync(deps: CliDeps, job: Job<ListSyncJobData>): Promise<void> {
  const { jobId, oltId } = job.data;
  await runReadJob(deps, jobId, oltId, async (run) => {
    const raw = new Map<OltList['key'], string>();
    for (const list of LISTS) raw.set(list.key, await run(list.command()));

    const result: Record<string, unknown> = {};
    const failed: string[] = [];
    for (const list of LISTS) {
      const output = raw.get(list.key)!;
      let parsed: ReturnType<OltList['parse']>;
      try {
        parsed = list.parse(output);
      } catch (error) {
        // The output is a list of VLANs or profile names, no secrets: keep it for the parser fix.
        failed.push(list.key);
        result[list.key] = { error: 'parse_failed', message: error instanceof ParseError ? error.message : (error as Error).name, output: output.slice(0, 2000) };
        continue;
      }
      const { values, skipped } = parsed;
      const { count } = await deps.prisma.provisionAllowlist.createMany({ data: values.map((value) => ({ oltId, kind: list.kind, value })), skipDuplicates: true });
      result[list.key] = { found: values, added: count, ...(skipped.length ? { skipped } : {}) };
    }
    if (failed.length) throw new ReadJobFailure('parse_failed', { ...result, failedLists: failed });
    return result;
  });
}
