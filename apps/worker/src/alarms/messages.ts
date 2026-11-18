import type { AlarmKind } from './rules/types.js';

// Telegram texts (Indonesian UI language, CLAUDE.md). Plain text: no parse_mode, so names from
// the OLT can never inject markup.

export interface AlarmMessageInput {
  kind: AlarmKind;
  phase: 'start' | 'end';
  olt: string;
  port?: string;
  count?: number;
  onuName?: string | null;
  /** olt_unreachable end: ONUs still offline after recovery. */
  stillOffline?: number;
  link: string;
}

export function alarmMessage(m: AlarmMessageInput): string {
  const where = m.port ? `${m.olt} port 1/${m.port}` : m.olt;
  const onu = m.onuName ? ` (${m.onuName})` : '';
  const lines: Record<AlarmKind, [string, string]> = {
    pon_mass_los: [`🔴 LOS massal di ${where}: ${m.count ?? '?'} ONU putus. Kemungkinan kabel feeder/splitter.`, `✅ Pulih: LOS massal di ${where}.`],
    pon_mass_power: [`🟠 ${m.count ?? '?'} ONU di ${where} DyingGasp: kemungkinan listrik padam.`, `✅ Pulih: listrik di ${where} kembali.`],
    onu_flapping: [`🟡 ONU${onu} di ${where} putus-sambung (flapping).`, `✅ ONU${onu} di ${where} stabil lagi.`],
    olt_unreachable: [`🔴 OLT ${m.olt} tidak terjangkau (2 siklus polling gagal).`, `✅ OLT ${m.olt} terjangkau lagi; ${m.stillOffline ?? 0} ONU masih offline.`],
    onu_los: [`ONU${onu} di ${where} LOS.`, `ONU${onu} di ${where} kembali normal.`],
    onu_rx_low: [`Rx ONU${onu} di ${where} rendah.`, `Rx ONU${onu} di ${where} normal.`],
  };
  return `${lines[m.kind][m.phase === 'start' ? 0 : 1]}\n${m.link}`;
}
