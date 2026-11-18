-- Teknisi ONU registrations wait for NOC/admin approval before they run (owner decision
-- 2026-11-10): preview -> pending_approval -> confirmed (approved) or rejected.
ALTER TYPE "JobStatus" ADD VALUE 'pending_approval' AFTER 'preview';
ALTER TYPE "JobStatus" ADD VALUE 'rejected';
