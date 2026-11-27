import {
  type AllowedCommand,
  expectedRegistrationLines,
  type OnuRebootParams,
  onuRebootParamsSchema,
  parseDetailInfo,
  parseOnuState,
  parseWriteResult,
  previewSha256,
  provisionParamsSchema,
  rebootOnu,
  registerOnuAndSave,
  renderPreview,
  showOnuDetail,
  showOnuMngConfig,
  showOnuRunningConfig,
  showOnuState,
  showPortRunningConfig,
  writeConfig,
} from '@olt/olt-spec';
import type { WriteJobData } from '@olt/shared/jobs';
import { type Job, UnrecoverableError } from 'bullmq';
import { CliError, HostKeyMismatchError } from '../cli/errors.js';
import type { CliDeps } from '../cli/jobs/onu-detail.js';
import { OltCliSession, type OltCliSessionOptions } from '../cli/olt-cli.session.js';
import { cliSessionOptions } from '../cli/ssh-algorithms.js';
import { quarantineOlt } from '../identity/quarantine.js';
import { IdentityMismatchError, verifySnmpIdentity } from '../identity/snmp-identity.js';
import { openOlt } from '../poller/context.js';

type Fail = { status: 'failed' | 'blocked'; error: string; message?: string };

/**
 * Fase 2 executor (SPEC §8.5): provision.onu-register (in the template of its mode), config.save
 * and onu.reboot, on any OLT inside OLT_TARGET_CIDRS (CLAUDE.md rule 3 since 2026-11-13).
 * Everything the api checked is checked again here, then commands go out one by one and the job
 * stops at the first error. A verified registration is saved with `write` in the same session; a
 * reboot changes no configuration and has no `write`. Write jobs are never retried once a command
 * may have been sent, so every exit path is an UnrecoverableError.
 */
export async function processWriteJob(deps: CliDeps, job: Job<WriteJobData>): Promise<void> {
  const { prisma } = deps;
  const { jobId } = job.data;
  const row = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const audit = (action: string, detail: object) => prisma.auditLog.create({ data: { actor: null, action, target: `job:${jobId}`, detail } });
  const finish = async (f: Fail, extra: object = {}) => {
    await prisma.job.update({ where: { id: jobId }, data: { status: f.status, result: { error: f.error, ...(f.message ? { message: f.message } : {}), ...extra } } });
    await audit(`job.${f.status}`, { error: f.error });
    throw new UnrecoverableError(f.error);
  };

  if (row.status !== 'confirmed') throw new UnrecoverableError(`job ${jobId} is ${row.status}`);
  if (row.oltId !== job.data.oltId) return finish({ status: 'failed', error: 'olt_mismatch' });
  const olt = await prisma.olt.findUniqueOrThrow({ where: { id: row.oltId }, include: { identities: { where: { kind: 'ssh_hostkey', status: 'pinned' } } } });

  // Guard 2 (SPEC §8.5): only addresses inside OLT_TARGET_CIDRS, checked before any SNMP or SSH.
  try {
    deps.guard.assertAllowed(olt.mgmtIp);
  } catch {
    await prisma.securityEvent.create({ data: { oltId: olt.id, kind: 'write_guard_denied', severity: 'critical', detail: { guard: 'worker', jobId, reason: 'outside OLT_TARGET_CIDRS' } } });
    return finish({ status: 'failed', error: 'write_guard_denied' });
  }
  if (olt.status !== 'ok') return finish({ status: 'blocked', error: `olt_${olt.status}` });
  if (!olt.cliEnabled || !olt.cliCredEnc || olt.identities.length === 0) return finish({ status: 'blocked', error: 'cli_not_ready' });
  let options: OltCliSessionOptions;
  try {
    options = cliSessionOptions(deps.cliOptions, olt.sshAlgorithms);
  } catch {
    return finish({ status: 'failed', error: 'ssh_algorithms_invalid' });
  }

  // Re-validate and re-render: the confirmed hash must still match (§2.2 no. 4).
  let commands: AllowedCommand[];
  let params: ReturnType<typeof provisionParamsSchema.parse> | undefined;
  let reboot: OnuRebootParams | undefined;
  try {
    if (row.kind === 'onu_register') {
      params = provisionParamsSchema.parse(row.params);
      commands = registerOnuAndSave(params);
    } else if (row.kind === 'onu_reboot') {
      reboot = onuRebootParamsSchema.parse(row.params);
      commands = rebootOnu(reboot);
    } else if (row.kind === 'config_save') {
      commands = [writeConfig()];
    } else {
      return finish({ status: 'failed', error: 'not_a_write_job' });
    }
  } catch {
    return finish({ status: 'failed', error: 'invalid_params' });
  }
  if (previewSha256(renderPreview(commands)) !== row.previewSha256) return finish({ status: 'failed', error: 'preview_mismatch', message: 'Preview berubah. Buat preview ulang.' });

  // Identity before any credential goes out (rule 7): SNMP here, the host key in the handshake.
  const { pin, client } = await openOlt(deps, olt.id);
  try {
    await verifySnmpIdentity(olt.name, client, pin);
  } catch (error) {
    if (error instanceof IdentityMismatchError && error.kind !== 'missing_pin') {
      await quarantineOlt(deps, olt.id, { kind: error.kind as 'snmp_engine_id' | 'snmp_sysinfo', expected: error.expected, observed: error.observed });
    }
    return finish({ status: 'blocked', error: 'identity_check_failed' });
  } finally {
    client.close();
  }

  await prisma.job.update({ where: { id: jobId }, data: { status: 'running' } });
  const credential = deps.decryptor.cli(olt.name, olt.cliCredEnc);
  const session = new OltCliSession(
    { name: olt.name, ip: olt.mgmtIp, port: deps.sshPort?.(olt.id) ?? 22, credential, hostKeyPins: olt.identities.map((i) => i.value) },
    deps.guard,
    options,
  );
  const applied: string[] = [];
  const transcript = () => session.transcript.map((t) => ({ command: t.command, output: t.output.split(credential.password).join('[redacted]') }));
  try {
    try {
      await session.open('write');
    } catch (error) {
      if (error instanceof HostKeyMismatchError) await quarantineOlt(deps, olt.id, { kind: 'ssh_hostkey', expected: olt.identities.map((i) => i.value).join(','), observed: error.observed });
      return await finish({ status: 'failed', error: (error as Error).name });
    }

    let before: object = {};
    if (params) {
      const pon = { slot: params.slot, port: params.port };
      const state = parseOnuState(await session.run(showOnuState(pon)));
      if (state.rows.some((r) => r.onuId === params!.onuId)) {
        return await finish({ status: 'failed', error: 'onu_id_taken', message: `ID ONU ${params.onuId} sudah terpakai. Buat preview ulang.` }, { transcript: transcript() });
      }
      before = { portRunningConfig: await session.run(showPortRunningConfig(pon)) };
      await prisma.job.update({ where: { id: jobId }, data: { beforeSnapshot: before } });
    }
    if (reboot) {
      // The ONU at that position must still be the one previewed (an ONU ID can be reused) and
      // online (an offline ONU cannot be reached); otherwise `reboot` is not sent.
      const where = `1/${reboot.slot}/${reboot.port}:${reboot.onuId}`;
      let detail: ReturnType<typeof parseDetailInfo>;
      try {
        detail = parseDetailInfo(await session.run(showOnuDetail({ slot: reboot.slot, port: reboot.port, onuId: reboot.onuId })));
      } catch (error) {
        const line = error instanceof CliError ? error.line : (error as Error).name;
        return await finish({ status: 'failed', error: 'onu_not_found', message: `ONU ${where} tidak terbaca di OLT (${line}); reboot tidak dikirim.` }, { transcript: transcript() });
      }
      if (detail.serialNumber.toUpperCase() !== reboot.sn) {
        return await finish(
          { status: 'failed', error: 'onu_mismatch', message: `ONU di ${where} bukan lagi ${reboot.sn}; reboot tidak dikirim. Muat ulang halaman ONU.` },
          { observedSn: detail.serialNumber, transcript: transcript() },
        );
      }
      if (detail.phase !== 'working') {
        return await finish(
          { status: 'failed', error: 'onu_not_online', message: `ONU ${reboot.sn} sedang ${detail.phaseLabel || 'tidak online'}; reboot tidak dikirim.` },
          { transcript: transcript() },
        );
      }
    }

    // A registration's last command (`write`) only goes out after verification, below.
    const apply = params ? commands.slice(0, -1) : commands;
    let saved: boolean | undefined;
    let lastOutput = '';
    for (const cmd of apply) {
      try {
        lastOutput = await session.run(cmd);
      } catch (error) {
        const line = error instanceof CliError ? error.line : (error as Error).name;
        return await finish({ status: 'failed', error: 'command_failed', message: `Perintah "${cmd.text}" gagal: ${line}` }, { failedCommand: cmd.text, transcript: transcript() });
      }
      // A confirmed command (`reboot`) sent its previewed answer as well.
      applied.push(...(cmd.confirm ? [cmd.text, cmd.confirm.answer] : [cmd.text]));
      await prisma.job.update({ where: { id: jobId }, data: { appliedCommands: applied } });
    }

    if (reboot) {
      // The OLT took `reboot` and its answer without an error; the ONU restarts on its own and
      // the status poll shows it going offline and coming back.
      await prisma.job.update({ where: { id: jobId }, data: { status: 'succeeded', result: { transcript: transcript() } } });
      await audit('job.succeeded', { applied: applied.length });
      return;
    }

    await prisma.job.update({ where: { id: jobId }, data: { status: 'verifying' } });
    if (params) {
      const pon = { slot: params.slot, port: params.port };
      const ref = { ...pon, onuId: params.onuId };
      const state = parseOnuState(await session.run(showOnuState(pon, params.onuId)));
      const running = await session.run(showOnuRunningConfig(ref));
      const mng = await session.run(showOnuMngConfig(ref));
      // The lines of the mode's template the OLT must now show (SPEC §8.5).
      const expected = expectedRegistrationLines(params);
      const missing = [...expected.running.filter((l) => !running.includes(l)), ...expected.mng.filter((l) => !mng.includes(l))];
      const ok = state.rows.length === 1 && missing.length === 0;
      const after = { portRunningConfig: await session.run(showPortRunningConfig(pon)), onuRunningConfig: running, onuMngConfig: mng };
      if (!ok) return await finish({ status: 'failed', error: 'verification_failed' }, { missing, transcript: transcript() });
      // Verified: save the running-config. A failed `write` leaves the ONU registered but
      // unsaved, so the job stays succeeded with a warning and shows in the unsaved panel.
      const save = commands.at(-1)!;
      try {
        saved = parseWriteResult(await session.run(save)).ok;
        applied.push(save.text);
        await prisma.job.update({ where: { id: jobId }, data: { appliedCommands: applied } });
      } catch {
        saved = false;
      }
      if (saved) {
        await prisma.$transaction([
          // `write` saved everything confirmed before as well.
          prisma.job.updateMany({ where: { oltId: olt.id, kind: 'onu_register', status: 'succeeded', savedByJobId: null }, data: { savedByJobId: jobId } }),
          prisma.job.update({ where: { id: jobId }, data: { status: 'succeeded', savedByJobId: jobId, afterSnapshot: after, result: { transcript: transcript(), saved: true } } }),
        ]);
      } else {
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'succeeded',
            afterSnapshot: after,
            result: { transcript: transcript(), saved: false, saveError: 'write_not_ok', message: 'ONU terdaftar dan terverifikasi, tetapi konfigurasi gagal disimpan (write). Simpan lewat panel perubahan belum disimpan.' },
          },
        });
      }
    } else {
      if (!parseWriteResult(lastOutput).ok) return await finish({ status: 'failed', error: 'write_not_ok' }, { transcript: transcript() });
      await prisma.$transaction([
        prisma.job.update({ where: { id: jobId }, data: { status: 'succeeded', result: { transcript: transcript() } } }),
        // Everything confirmed up to now is in the saved config.
        prisma.job.updateMany({ where: { oltId: olt.id, kind: 'onu_register', status: 'succeeded', savedByJobId: null }, data: { savedByJobId: jobId } }),
      ]);
    }
    await audit('job.succeeded', { applied: applied.length, ...(saved === undefined ? {} : { saved }) });
  } finally {
    await session.close();
  }
}
