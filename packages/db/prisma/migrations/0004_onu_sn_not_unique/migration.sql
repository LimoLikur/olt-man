-- A real C320 can hold the same SN at two positions (golden olt-a: 4 of 133 SNs, e.g. an ONU
-- moved to another port while its old entry stayed). Active ONUs stay unique per position only;
-- the plain (olt_id, sn) index from 0001 still serves lookups.
DROP INDEX "onu_active_sn_key";
