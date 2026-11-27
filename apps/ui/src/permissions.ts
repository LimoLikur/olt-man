import type { Role } from './api';

/**
 * Which roles may do what (SPEC §8.6). The api enforces RBAC; this map only drives what the UI
 * offers, so menus, buttons and the Users page matrix share one source.
 */
export const PERMISSIONS = {
  viewNetwork: ['admin', 'noc', 'teknisi'],
  acknowledgeAlarm: ['admin', 'noc'],
  manageOlts: ['admin', 'noc'],
  adminOlts: ['admin'],
  composeRegistration: ['admin', 'teknisi'],
  approveRegistration: ['admin', 'noc'],
  rebootOnu: ['admin', 'noc', 'teknisi'],
  runJobs: ['admin'],
  manageUsers: ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_LABELS: Record<Permission, string> = {
  viewNetwork: 'View dashboard, OLTs, ONUs and alarms; refresh ONU details',
  acknowledgeAlarm: 'Acknowledge alarms',
  manageOlts: 'Add OLTs, probe and pin identity, delete OLTs',
  adminOlts: 'Change OLT credentials, accept identity changes, delete quarantined OLTs',
  composeRegistration: 'Compose ONU registrations (technicians submit them for approval)',
  approveRegistration: "Approve or reject technicians' registrations",
  rebootOnu: 'Reboot ONUs (runs once the preview is confirmed, no approval)',
  runJobs: 'Save the OLT configuration (write) and other jobs',
  manageUsers: 'Reset NOC and technician passwords',
};

export const ROLES: readonly Role[] = ['admin', 'noc', 'teknisi'];

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
