import Migration0034 from "./034_ProjectionThreadsSnoozed.ts";

// Older fork builds assigned migration ID 34 to ProjectionThreadSubagents.
// Reapply the idempotent upstream snooze migration at a fresh ID so those
// databases receive the columns without changing their migration history.
export default Migration0034;
