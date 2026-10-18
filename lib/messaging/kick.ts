import "server-only";
import { after } from "next/server";
import { tick } from "./worker";

// Runs a tick after the response is sent, so a message queued by this request
// goes out in seconds instead of waiting for the next minute. The cron tick is
// the backstop if this one fails.
export function kickQueue() {
  after(async () => {
    try {
      await tick();
    } catch (err) {
      console.error("queue kick failed", err);
    }
  });
}
