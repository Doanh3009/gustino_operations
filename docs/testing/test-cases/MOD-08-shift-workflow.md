# MOD-08 — Automatic shift workflow and handover

Status: in progress; multi-device integration pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD08-TC-AUTO-01 | Leader checks in | Operational shift opens automatically without a Receive button | `test-shift-realtime-reminders.mjs` Passed |
| MOD08-TC-DAY-01 | Previous shift left open across date | Stale shift closes and new business date starts at Ca 1 | Static contract Passed |
| MOD08-TC-PHOTO-01 | Today checklist | Step 1 is opening counter photo; last step is closing counter photo | Static contract Passed |
| MOD08-TC-HANDOVER-01 | Close and hand over | Existing inventory handover remains required | TypeScript/build Passed; integration pending |
| MOD08-TC-LOAD-01 | Attendance or POS ledger fails while opening Handover | Screen shows the load error and retains prior valid state; it must not continue as if sales/attendance were empty | Pre-fix failed; `CRITICAL_LOAD_FAILURE_VISIBILITY_OK` and related regressions Passed |
