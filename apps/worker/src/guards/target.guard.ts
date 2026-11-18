import { BlockList, isIP } from 'node:net';

export class TargetNotAllowedError extends Error {
  constructor(readonly target: string) {
    super(`target ${target} is outside OLT_TARGET_CIDRS`);
    this.name = 'TargetNotAllowedError';
  }
}

function blockList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [net, bits] = cidr.split('/');
    const family = isIP(net ?? '');
    if (!family || bits === undefined || !/^\d{1,3}$/.test(bits)) throw new Error(`invalid CIDR: ${cidr}`);
    list.addSubnet(net!, Number(bits), family === 6 ? 'ipv6' : 'ipv4');
  }
  return list;
}

/**
 * The worker's allowlist of reachable addresses (SPEC §2.2 no. 9, CLAUDE.md rule 4). Every
 * SNMP/SSH client calls assertAllowed() before opening a socket. Only literal IPs are
 * accepted, so DNS cannot redirect a connection outside the allowlist.
 */
export class TargetGuard {
  private readonly targets: BlockList;
  private readonly mocks: BlockList;

  constructor(targetCidrs: readonly string[], mockCidrs: readonly string[]) {
    if (targetCidrs.length === 0) throw new Error('OLT_TARGET_CIDRS is empty');
    this.targets = blockList(targetCidrs);
    this.mocks = blockList(mockCidrs);
  }

  isAllowed(ip: string): boolean {
    const family = isIP(ip);
    return family !== 0 && this.targets.check(ip, family === 6 ? 'ipv6' : 'ipv4');
  }

  assertAllowed(ip: string): void {
    if (!this.isAllowed(ip)) throw new TargetNotAllowedError(ip);
  }

  /** Write guard 2 (SPEC §8.5): the address must be inside MOCK_OLT_CIDRS. */
  isMockNetwork(ip: string): boolean {
    const family = isIP(ip);
    return family !== 0 && this.isAllowed(ip) && this.mocks.check(ip, family === 6 ? 'ipv6' : 'ipv4');
  }
}
