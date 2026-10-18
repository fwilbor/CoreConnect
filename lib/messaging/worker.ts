import "server-only";
import { serviceDb, type Database } from "@/lib/db";
import { runDueSequenceSteps } from "./automations";
import { deliverDueMessages } from "./send";
import { defaultTransports, type Transports } from "./transports";

// One scheduler tick: queue due sequence steps, then deliver due messages.
// Called every minute by /api/jobs/tick, and right after events that queue a
// message (so an auto-reply goes out in seconds, not at the next tick).
export async function tick(db: Database = serviceDb(), transports: Transports = defaultTransports()) {
  const sequences = await runDueSequenceSteps(db);
  const messages = await deliverDueMessages(db, transports);
  return { sequences, messages };
}
