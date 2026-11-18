-- Per-OLT legacy SSH algorithms (older C320 firmware offers e.g. only aes128-cbc). Values are
-- validated against an allowlist in the api and again in the worker; {} = ssh2 defaults only.
ALTER TABLE "olt" ADD COLUMN "ssh_algorithms" JSONB NOT NULL DEFAULT '{}';
