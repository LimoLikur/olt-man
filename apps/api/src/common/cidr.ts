import { BlockList, isIP } from 'node:net';

/** Matches literal IPv4/IPv6 addresses against a CIDR list. */
export class CidrMatcher {
  private readonly list = new BlockList();

  constructor(cidrs: readonly string[]) {
    for (const cidr of cidrs) {
      const [net, bits] = cidr.split('/');
      const family = isIP(net ?? '');
      if (!family || bits === undefined) throw new Error(`invalid CIDR: ${cidr}`);
      this.list.addSubnet(net!, Number(bits), family === 6 ? 'ipv6' : 'ipv4');
    }
  }

  contains(ip: string): boolean {
    const family = isIP(ip);
    return family !== 0 && this.list.check(ip, family === 6 ? 'ipv6' : 'ipv4');
  }
}
