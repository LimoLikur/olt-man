// Demo: turn captured CLI output into validated JSON.
// Usage: parse [kind] <file|->   kind: auto (default) | state | attenuation | detail-info | interface |
//        onu-running-config | onu-mng-config | port-running-config | card | write
import { readFileSync } from 'node:fs';
import * as p from '../parsers/index.js';

const PARSERS: Record<string, (raw: string) => unknown> = {
  state: p.parseOnuState,
  attenuation: p.parseAttenuation,
  'detail-info': p.parseDetailInfo,
  interface: p.parseOnuInterface,
  'onu-running-config': p.parseOnuRunningConfig,
  'onu-mng-config': p.parseOnuMngConfig,
  'port-running-config': p.parsePortRunningConfig,
  card: p.parseCard,
  write: p.parseWriteResult,
};

/** Picks a parser from the echoed command or the output shape. */
function detect(raw: string): string {
  const t = p.normalize(raw);
  if (/^OnuIndex\s+Admin State/m.test(t)) return 'state';
  if (/^\s*up\s+Rx\s*:/m.test(t)) return 'attenuation';
  if (/^ONU interface:/m.test(t)) return 'detail-info';
  if (/^ONU statistic:/m.test(t)) return 'interface';
  if (/^pon-onu-mng gpon-onu_/m.test(t)) return 'onu-mng-config';
  if (/^interface gpon-onu_/m.test(t)) return 'onu-running-config';
  if (/^interface gpon-olt_/m.test(t)) return 'port-running-config';
  if (/^Rack\s+Shelf\s+Slot\s+Cfgtype/m.test(t)) return 'card';
  if (/\[OK\]|Building configuration/.test(t)) return 'write';
  throw new p.ParseError('cannot detect output type; pass a kind');
}

const args = process.argv.slice(2);
const file = args.at(-1);
const kind = args.length > 1 ? args[0]! : 'auto';
if (!file || (kind !== 'auto' && !PARSERS[kind])) {
  console.error(`usage: parse [auto|${Object.keys(PARSERS).join('|')}] <file|->`);
  process.exit(2);
}

try {
  const raw = readFileSync(file === '-' ? 0 : file, 'utf8');
  const error = p.findCliError(raw);
  const chosen = kind === 'auto' ? detect(raw) : kind;
  console.log(JSON.stringify({ kind: chosen, cliError: error, data: PARSERS[chosen]!(raw) }, null, 2));
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
