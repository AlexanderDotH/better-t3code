import Migration0037 from "./037_ProjectionThreadSubagents.ts";

// Some fork databases recorded a different migration at ID 37. Reapplying the
// idempotent table migration at a fresh ID converges both ledger histories.
export default Migration0037;
