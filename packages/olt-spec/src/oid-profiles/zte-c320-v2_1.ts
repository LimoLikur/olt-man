import * as c from './common.js';
import type { IndexArcs, OidProfile } from './types.js';

const B = '1.3.6.1.4.1.3902.1012';
// gpon-olt ifIndex: 0x10000000 | slot << 16 | port << 8 (gpon-olt_1/1/1 = 268501248).
const TYPE = 0x10000000;

// rxOnu (3.50.12.1.1.10) is indexed ponIfIndex.onuId.1 on olt-a (133/133 rows end in .1).
const INDEX_ARCS: IndexArcs = { rxOnu: [1] };

// Phase column of the 1012 table as observed on olt-a (V2.1.0, 133 ONUs vs `show gpon onu state`).
// It numbers one lower than 1082. Values not seen yet (logging, syncMib, authFailed) decode as unknown.
const phase = c.phaseCodec({ 1: 'los', 3: 'working', 4: 'dying_gasp', 6: 'offline' });

/**
 * Firmware V2.1.x, enterprise base 1012. Verified by golden recording olt-a (V2.1.0, 2026-11-06).
 * Not covered by that recording: OLT-side Rx near the receiver floor (about -30 dBm and weaker).
 */
export const zteC320V21: OidProfile = {
  id: 'zte-c320-v2.1',
  verified: true,
  base: B,
  indexArcs: INDEX_ARCS,
  columns: {
    type: `${B}.3.28.1.1.1`,
    name: `${B}.3.28.1.1.2`,
    description: `${B}.3.28.1.1.3`,
    serialNumber: `${B}.3.28.1.1.5`,
    adminState: `${B}.3.28.2.1.1`,
    omccState: `${B}.3.28.2.1.3`,
    phaseState: `${B}.3.28.2.1.4`,
    rxOnu: `${B}.3.50.12.1.1.10`,
    rxOlt: '1.3.6.1.4.1.3902.1015.1010.11.2.1.2',
  },
  encodeOnuIndex(ref, column) {
    c.assertOnuRef(ref);
    return [TYPE | (ref.slot << 16) | (ref.port << 8), ref.onuId, ...c.arcsOf(INDEX_ARCS, column)];
  },
  decodeOnuIndex(suffix, column) {
    const [pon, onuId] = c.suffixPair(suffix, c.arcsOf(INDEX_ARCS, column));
    if ((pon & 0xff0000ff) >>> 0 !== TYPE) throw new RangeError('not a v2.1 gpon-olt ifIndex');
    const ref = { slot: (pon >> 16) & 0xff, port: (pon >> 8) & 0xff, onuId };
    c.assertOnuRef(ref);
    return ref;
  },
  phaseState: phase.phaseState,
  phaseRaw: phase.phaseRaw,
  adminStateRaw: c.adminStateRaw,
  adminEnabled: c.adminEnabled,
  rxOnuDbm: c.rxOnuDbm,
  rxOnuRaw: c.rxOnuRaw,
  rxOltDbm: c.rxOltDbm,
  rxOltRaw: c.rxOltRaw,
  encodeSerial: c.encodeSerial,
  decodeSerial: c.decodeSerial,
};
