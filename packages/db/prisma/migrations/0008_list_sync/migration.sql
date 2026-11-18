-- The read job now fetches VLANs and T-CONT profiles (owner decision 2026-11-13).
ALTER TYPE "JobKind" RENAME VALUE 'vlan_sync' TO 'list_sync';
