# MOD-08 — Automatic shift workflow and handover

Status: in progress; isolated LAN browser integration passed, cloud/multi-device integration pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD08-TC-AUTO-01 | Leader checks in | Operational shift opens automatically without a Receive button | `test-shift-realtime-reminders.mjs` and isolated `qa-handover.mjs` Passed |
| MOD08-TC-DAY-01 | Previous shift left open across date | Stale shift closes and new business date starts at Ca 1 | Static contract Passed |
| MOD08-TC-PHOTO-01 | Today checklist | Step 1 is opening counter photo; last step is closing counter photo | Static contract Passed |
| MOD08-TC-HANDOVER-01 | Close and hand over | Existing inventory handover remains required; closing Ca sáng opens the report, returning to Handover opens Ca tối from the active attendance, and closing Ca tối opens the report again | `HANDOVER_QA_OK` against a fresh isolated LAN store: two sessions created and both closed with opening/closing balances and count movements; cloud/multi-device integration pending |
| MOD08-TC-LOAD-01 | Attendance or POS ledger fails while opening Handover | Screen shows the load error and retains prior valid state; it must not continue as if sales/attendance were empty | Pre-fix failed; `CRITICAL_LOAD_FAILURE_VISIBILITY_OK` and related regressions Passed |
| MOD08-TC-POS-01 | Staff records a POS receipt while the leader's shift is open | Handover shows the staff seller and sold quantity from the in-shift receipt before close | `HANDOVER_QA_OK`: isolated store retained one 3-item/90,000đ receipt and the browser found the staff sale group |
| MOD08-TC-OWNER-01 | Ca 1 leader remains checked in when Ca 1 closes and another scheduled leader owns Ca 2 | Ca 1 leader cannot create/close Ca 2; the checked-in Ca 2 leader receives the next sequence automatically | `AUTO_SECOND_SHIFT_START_OK`, two-leader isolated `HANDOVER_QA_OK`, close/report regressions Passed; production guard deployed, signed-in confirmation pending |
| MOD08-TC-CUSTOM-01 | Approved all-day leader registration has no `shift_id` | It may open only configured leader shifts fully covered by its registered time; a partial/unmatched custom range opens none | `AUTO_SECOND_SHIFT_START_OK` fixtures for both sequences and rejection Passed; production guard deployed |
| MOD08-TC-LOAD-02 | Configured leader-shift read fails | Handover exposes the load error and does not silently replace the schedule with `[]`, which would strand the correct Ca 2 leader | `SHIFT_REALTIME_REMINDERS_OK` + `CRITICAL_LOAD_FAILURE_VISIBILITY_OK` Passed |

The 2026-07-20 integration batch corrected only the QA harness: each actor registers their own shift, the leader's check-in drives automatic opening, and close navigates directly to the existing report. No application or business-rule code changed.
