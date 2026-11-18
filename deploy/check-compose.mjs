#!/usr/bin/env node
// SPEC §9 / PLAN J1: every service non-root, read_only, cap_drop ALL, no-new-privileges; only
// caddy publishes ports (dev may add loopback-only ports); the credential private key is
// mounted into the worker only. Checks the resolved config of every profile.
// Usage: node deploy/check-compose.mjs   (exit 1 on any violation)
import { execFileSync } from 'node:child_process';

const PROFILES = [[], ['demo'], ['dev']];
const problems = [];

for (const profiles of PROFILES) {
  const label = profiles.length ? profiles.join(',') : 'production';
  const args = ['compose', ...profiles.flatMap((p) => ['--profile', p]), 'config', '--format', 'json'];
  const config = JSON.parse(execFileSync('docker', args, { encoding: 'utf8' }));
  for (const [name, svc] of Object.entries(config.services)) {
    const where = `[${label}] ${name}`;
    const user = String(svc.user ?? '');
    if (!user || /^(0|root)(:|$)/.test(user)) problems.push(`${where}: runs as root (user: ${user || 'unset'})`);
    if (svc.read_only !== true) problems.push(`${where}: read_only is not true`);
    if (!(svc.cap_drop ?? []).includes('ALL')) problems.push(`${where}: cap_drop does not include ALL`);
    if (!(svc.security_opt ?? []).some((o) => /^no-new-privileges(:true)?$/.test(o))) problems.push(`${where}: no-new-privileges missing`);
    if ((svc.cap_add ?? []).length) problems.push(`${where}: cap_add ${svc.cap_add.join(',')}`);
    if (svc.privileged) problems.push(`${where}: privileged`);
    for (const port of svc.ports ?? []) {
      const loopback = port.host_ip === '127.0.0.1' || port.host_ip === '::1';
      if (name !== 'caddy' && !(label === 'dev' && loopback)) problems.push(`${where}: publishes port ${port.published}${port.host_ip ? ` on ${port.host_ip}` : ''}`);
    }
    const secrets = (svc.secrets ?? []).map((s) => s.source);
    if (secrets.includes('olt_cred_key') && name !== 'worker') problems.push(`${where}: has the credential private key`);
    for (const [k, v] of Object.entries(svc.environment ?? {})) {
      if (/PRIVATE_KEY(?!_FILE)/.test(k) || /BEGIN [A-Z ]*PRIVATE KEY/.test(String(v))) problems.push(`${where}: private key in environment (${k})`);
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ compose hardening OK for profiles: ${PROFILES.map((p) => p.join(',') || 'production').join(', ')}`);
