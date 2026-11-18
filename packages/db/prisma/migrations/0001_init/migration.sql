-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'noc', 'teknisi');

-- CreateEnum
CREATE TYPE "OltStatus" AS ENUM ('pending_pin', 'ok', 'stale', 'unreachable', 'quarantined', 'disabled');

-- CreateEnum
CREATE TYPE "SnmpVersion" AS ENUM ('v3', 'v2c');

-- CreateEnum
CREATE TYPE "MgmtPath" AS ENUM ('inband', 'outband', 'unknown');

-- CreateEnum
CREATE TYPE "IdentityKind" AS ENUM ('ssh_hostkey', 'snmp_engine_id', 'snmp_sysinfo');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('candidate', 'pinned', 'retired');

-- CreateEnum
CREATE TYPE "OnuEventKind" AS ENUM ('state_change', 'device_replaced', 'archived', 'removed');

-- CreateEnum
CREATE TYPE "PollKind" AS ENUM ('status', 'optical', 'inventory', 'metrics', 'traffic');

-- CreateEnum
CREATE TYPE "AlarmKind" AS ENUM ('onu_los', 'onu_flapping', 'onu_rx_low', 'pon_mass_los', 'pon_mass_power', 'olt_unreachable', 'olt_identity_mismatch', 'cli_unavailable');

-- CreateEnum
CREATE TYPE "AlarmSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlarmState" AS ENUM ('active', 'cleared');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "SecurityEventKind" AS ENUM ('identity_mismatch', 'arp_change', 'snmp_auth_failure', 'cli_auth_failed', 'admin_offlan_denied', 'write_guard_denied', 'trap_unknown_source');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('identity_probe', 'onu_detail', 'port_sweep', 'onu_register', 'config_save');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('draft', 'preview', 'confirmed', 'running', 'verifying', 'succeeded', 'failed', 'blocked', 'cancelled');

-- CreateEnum
CREATE TYPE "AllowlistKind" AS ENUM ('onu_type', 'tcont_profile', 'vlan');

-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id_hash" CHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ip" INET NOT NULL,
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id_hash")
);

-- CreateTable
CREATE TABLE "olt" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "mgmt_ip" INET NOT NULL,
    "is_mock" BOOLEAN NOT NULL,
    "oid_profile" VARCHAR(32) NOT NULL,
    "firmware" VARCHAR(128),
    "mgmt_path" "MgmtPath" NOT NULL DEFAULT 'unknown',
    "snmp_version" "SnmpVersion" NOT NULL,
    "snmp_cred_enc" BYTEA NOT NULL,
    "cli_enabled" BOOLEAN NOT NULL DEFAULT false,
    "cli_cred_enc" BYTEA,
    "status" "OltStatus" NOT NULL DEFAULT 'pending_pin',
    "status_interval_s" INTEGER NOT NULL DEFAULT 60,
    "alarm_settings" JSONB NOT NULL DEFAULT '{}',
    "last_poll_ok_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olt_identity" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "kind" "IdentityKind" NOT NULL,
    "value" VARCHAR(512) NOT NULL,
    "algo" VARCHAR(32),
    "label" VARCHAR(64),
    "status" "IdentityStatus" NOT NULL DEFAULT 'candidate',
    "reason" VARCHAR(512),
    "pinned_by" INTEGER,
    "pinned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olt_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_window" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(512) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pon_port" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "slot" SMALLINT NOT NULL,
    "port" SMALLINT NOT NULL,

    CONSTRAINT "pon_port_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onu" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "pon_port_id" INTEGER NOT NULL,
    "onu_index" SMALLINT NOT NULL,
    "sn" VARCHAR(16) NOT NULL,
    "type" VARCHAR(32),
    "name" VARCHAR(64),
    "description" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "onu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onu_state" (
    "onu_id" INTEGER NOT NULL,
    "phase_state" VARCHAR(16) NOT NULL,
    "admin_state" VARCHAR(16),
    "omcc_state" VARCHAR(16),
    "rx_dbm" DECIMAL(6,3),
    "olt_rx_dbm" DECIMAL(6,3),
    "last_change_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onu_state_pkey" PRIMARY KEY ("onu_id")
);

-- CreateTable
CREATE TABLE "onu_metric" (
    "id" BIGSERIAL NOT NULL,
    "onu_id" INTEGER NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "rx_dbm" DECIMAL(6,3),
    "olt_rx_dbm" DECIMAL(6,3),

    CONSTRAINT "onu_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onu_metric_hourly" (
    "onu_id" INTEGER NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "rx_avg_dbm" DECIMAL(6,3),
    "rx_min_dbm" DECIMAL(6,3),
    "rx_max_dbm" DECIMAL(6,3),
    "olt_rx_avg_dbm" DECIMAL(6,3),
    "samples" INTEGER NOT NULL,

    CONSTRAINT "onu_metric_hourly_pkey" PRIMARY KEY ("onu_id","hour")
);

-- CreateTable
CREATE TABLE "onu_traffic" (
    "id" BIGSERIAL NOT NULL,
    "onu_id" INTEGER NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "in_bps" BIGINT,
    "out_bps" BIGINT,
    "in_pps" BIGINT,
    "out_pps" BIGINT,
    "source" VARCHAR(8) NOT NULL,

    CONSTRAINT "onu_traffic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olt_metric" (
    "id" BIGSERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "metric" VARCHAR(64) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "olt_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onu_event" (
    "id" BIGSERIAL NOT NULL,
    "onu_id" INTEGER NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "kind" "OnuEventKind" NOT NULL,
    "from_state" VARCHAR(16),
    "to_state" VARCHAR(16),
    "cause" VARCHAR(32),
    "observed_after_gap" BOOLEAN NOT NULL DEFAULT false,
    "detail" JSONB,

    CONSTRAINT "onu_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_run" (
    "id" BIGSERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "kind" "PollKind" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "ok" BOOLEAN,
    "error" VARCHAR(512),

    CONSTRAINT "poll_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "pon_port_id" INTEGER,
    "onu_id" INTEGER,
    "kind" "AlarmKind" NOT NULL,
    "severity" "AlarmSeverity" NOT NULL,
    "state" "AlarmState" NOT NULL DEFAULT 'active',
    "parent_alarm_id" INTEGER,
    "first_at" TIMESTAMPTZ(3) NOT NULL,
    "last_at" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "detail" JSONB,
    "ack_by" INTEGER,
    "ack_at" TIMESTAMPTZ(3),
    "cleared_at" TIMESTAMPTZ(3),

    CONSTRAINT "alarm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" BIGSERIAL NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(512),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_event" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER,
    "kind" "SecurityEventKind" NOT NULL,
    "severity" "AlarmSeverity" NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by" INTEGER,

    CONSTRAINT "security_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "kind" "JobKind" NOT NULL,
    "params" JSONB NOT NULL,
    "preview" TEXT,
    "preview_sha256" CHAR(64),
    "status" "JobStatus" NOT NULL,
    "requested_by" INTEGER,
    "confirmed_by" INTEGER,
    "result" JSONB,
    "applied_commands" JSONB,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "saved_by_job_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provision_allowlist" (
    "id" SERIAL NOT NULL,
    "olt_id" INTEGER NOT NULL,
    "kind" "AllowlistKind" NOT NULL,
    "value" VARCHAR(32) NOT NULL,

    CONSTRAINT "provision_allowlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" INTEGER,
    "action" VARCHAR(64) NOT NULL,
    "target" VARCHAR(128),
    "detail" JSONB,
    "ip" INET,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "olt_name_key" ON "olt"("name");

-- CreateIndex
CREATE INDEX "olt_identity_olt_id_kind_status_idx" ON "olt_identity"("olt_id", "kind", "status");

-- CreateIndex
CREATE INDEX "maintenance_window_olt_id_starts_at_idx" ON "maintenance_window"("olt_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "pon_port_olt_id_slot_port_key" ON "pon_port"("olt_id", "slot", "port");

-- CreateIndex
CREATE INDEX "onu_olt_id_pon_port_id_onu_index_idx" ON "onu"("olt_id", "pon_port_id", "onu_index");

-- CreateIndex
CREATE INDEX "onu_olt_id_sn_idx" ON "onu"("olt_id", "sn");

-- CreateIndex
CREATE INDEX "onu_metric_onu_id_ts_desc_idx" ON "onu_metric"("onu_id", "ts" DESC);

-- CreateIndex
CREATE INDEX "onu_traffic_onu_id_ts_idx" ON "onu_traffic"("onu_id", "ts");

-- CreateIndex
CREATE INDEX "olt_metric_olt_id_metric_ts_idx" ON "olt_metric"("olt_id", "metric", "ts");

-- CreateIndex
CREATE INDEX "onu_event_onu_id_ts_idx" ON "onu_event"("onu_id", "ts");

-- CreateIndex
CREATE INDEX "poll_run_olt_id_kind_started_at_idx" ON "poll_run"("olt_id", "kind", "started_at");

-- CreateIndex
CREATE INDEX "alarm_olt_id_state_idx" ON "alarm"("olt_id", "state");

-- CreateIndex
CREATE INDEX "alarm_parent_alarm_id_idx" ON "alarm"("parent_alarm_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_dedupe_key_key" ON "notification"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_status_created_at_idx" ON "notification"("status", "created_at");

-- CreateIndex
CREATE INDEX "security_event_olt_id_created_at_idx" ON "security_event"("olt_id", "created_at");

-- CreateIndex
CREATE INDEX "job_olt_id_status_idx" ON "job"("olt_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provision_allowlist_olt_id_kind_value_key" ON "provision_allowlist"("olt_id", "kind", "value");

-- CreateIndex
CREATE INDEX "audit_log_ts_idx" ON "audit_log"("ts");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olt_identity" ADD CONSTRAINT "olt_identity_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_window" ADD CONSTRAINT "maintenance_window_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pon_port" ADD CONSTRAINT "pon_port_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onu" ADD CONSTRAINT "onu_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onu" ADD CONSTRAINT "onu_pon_port_id_fkey" FOREIGN KEY ("pon_port_id") REFERENCES "pon_port"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onu_state" ADD CONSTRAINT "onu_state_onu_id_fkey" FOREIGN KEY ("onu_id") REFERENCES "onu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onu_metric" ADD CONSTRAINT "onu_metric_onu_id_fkey" FOREIGN KEY ("onu_id") REFERENCES "onu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onu_metric_hourly" ADD CONSTRAINT "onu_metric_hourly_onu_id_fkey" FOREIGN KEY ("onu_id") REFERENCES "onu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onu_traffic" ADD CONSTRAINT "onu_traffic_onu_id_fkey" FOREIGN KEY ("onu_id") REFERENCES "onu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olt_metric" ADD CONSTRAINT "olt_metric_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onu_event" ADD CONSTRAINT "onu_event_onu_id_fkey" FOREIGN KEY ("onu_id") REFERENCES "onu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_run" ADD CONSTRAINT "poll_run_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm" ADD CONSTRAINT "alarm_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm" ADD CONSTRAINT "alarm_pon_port_id_fkey" FOREIGN KEY ("pon_port_id") REFERENCES "pon_port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm" ADD CONSTRAINT "alarm_onu_id_fkey" FOREIGN KEY ("onu_id") REFERENCES "onu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarm" ADD CONSTRAINT "alarm_parent_alarm_id_fkey" FOREIGN KEY ("parent_alarm_id") REFERENCES "alarm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_saved_by_job_id_fkey" FOREIGN KEY ("saved_by_job_id") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provision_allowlist" ADD CONSTRAINT "provision_allowlist_olt_id_fkey" FOREIGN KEY ("olt_id") REFERENCES "olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

