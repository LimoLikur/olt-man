import * as c from './common.js';
import type { IndexArcs, OidProfile } from './types.js';

const B = '1.3.6.1.4.1.3902.1082';
// gpon-olt ifIndex: 0x11010000 | slot << 8 | port (rack 1, shelf 1).
const TYPE = 0x11010000;

// rxOnu (500.20.2.2.2.1.10) is indexed ponIfIndex.onuId.1 on olt-a (133/133 rows end in .1).
const INDEX_ARCS: IndexArcs = { rxOnu: [1] };

// Phase column of the 1082 table as observed on olt-a, which serves 1082 next to 1012 (V2.1.0).
// Not yet seen on V2.2 firmware. Values not seen yet (logging, syncMib, authFailed) decode as unknown.
const phase = c.phaseCodec({ 2: 'los', 4: 'working', 5: 'dying_gasp', 7: 'offline' });

/** Firmware V2.2 and later, enterprise base 1082. Hypothesis from the technical brief; not verified. */
export const zteC320V22: OidProfile = {
  id: 'zte-c320-v2.2',
  verified: false,
  base: B,
  indexArcs: INDEX_ARCS,
  columns: {
    type: `${B}.500.10.2.3.3.1.1`,
    name: `${B}.500.10.2.3.3.1.2`,
    description: `${B}.500.10.2.3.3.1.3`,
    serialNumber: `${B}.500.10.2.3.3.1.18`,
    adminState: `${B}.500.10.2.3.8.1.1`,
    omccState: `${B}.500.10.2.3.8.1.3`,
    phaseState: `${B}.500.10.2.3.8.1.4`,
    rxOnu: `${B}.500.20.2.2.2.1.10`,
    rxOlt: `${B}.500.1.2.4.2.1.2`,
  },
  encodeOnuIndex(ref, column) {
    c.assertOnuRef(ref);
    return [TYPE | (ref.slot << 8) | ref.port, ref.onuId, ...c.arcsOf(INDEX_ARCS, column)];
  },
  decodeOnuIndex(suffix, column) {
    const [pon, onuId] = c.suffixPair(suffix, c.arcsOf(INDEX_ARCS, column));
    if ((pon & 0xffff0000) >>> 0 !== TYPE) throw new RangeError('not a v2.2 gpon-olt ifIndex');
    const ref = { slot: (pon >> 8) & 0xff, port: pon & 0xff, onuId };
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
