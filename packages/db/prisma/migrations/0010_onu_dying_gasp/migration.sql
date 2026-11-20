-- Per-ONU DyingGasp alarm (no longer only per-port mass).
ALTER TYPE "AlarmKind" ADD VALUE 'onu_dying_gasp' AFTER 'onu_los';
