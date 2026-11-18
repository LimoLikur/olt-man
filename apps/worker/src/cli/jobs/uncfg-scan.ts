import { NO_RELATED_INFO, ParseError, parseOnuUncfg, showOnuUncfg } from '@olt/olt-spec';
import type { UncfgScanJobData } from '@olt/shared/jobs';
import type { Job } from 'bullmq';
import { CliError } from '../errors.js';
import type { CliDeps } from './onu-detail.js';
import { ReadJobFailure, runReadJob } from './read-job.js';

/**
 * cli.uncfg-scan (SPEC §8.5): reads `show gpon onu uncfg` and keeps the unregistered ONUs on the
 * job row; the registration page shows the latest scan per OLT. One attempt, read session.
 */
export async function processUncfgScan(deps: CliDeps, job: Job<UncfgScanJobData>): Promise<void> {
  const { jobId, oltId } = job.data;
  await runReadJob(deps, jobId, oltId, async (run) => {
    let raw: string;
    try {
      raw = await run(showOnuUncfg());
    } catch (error) {
      // "%Code 62310-GPONSRV : No related information to show." is the empty answer, not an error.
      if (!(error instanceof CliError && NO_RELATED_INFO.test(error.line))) throw error;
      raw = error.line;
    }
    try {
      return { onus: parseOnuUncfg(raw).onus };
    } catch (error) {
      throw new ReadJobFailure('parse_failed', { message: error instanceof ParseError ? error.message : (error as Error).name, output: raw.slice(0, 2000) });
    }
  });
}
