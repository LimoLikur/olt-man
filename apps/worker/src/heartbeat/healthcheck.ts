// Container healthcheck: exit 0 when the heartbeat file is fresh.
import { readFileSync } from 'node:fs';

const file = process.env.HEARTBEAT_FILE ?? '/tmp/worker-heartbeat';
const maxAgeMs = 3 * Number(process.env.HEARTBEAT_INTERVAL_MS ?? 10_000);

try {
  const age = Date.now() - Number(readFileSync(file, 'utf8'));
  process.exit(age >= 0 && age < maxAgeMs ? 0 : 1);
} catch {
  process.exit(1);
}
