-- E6: alarm rule key and the outbox "sending" state.
ALTER TYPE "NotificationStatus" ADD VALUE 'sending' BEFORE 'sent';

ALTER TABLE "alarm" ADD COLUMN "key" VARCHAR(64) NOT NULL;
CREATE INDEX "alarm_olt_id_key_state_idx" ON "alarm"("olt_id", "key", "state");
