# MOD-20 — Supabase egress refresh reduction

Date: 2026-09-12. Scope: six user-authorized fixes; no database/schema/deployment changes.

| Case | Expected | Evidence/status |
|---|---|---|
| EG-01 | Today socket SUBSCRIBED suppresses interval reads; CHANNEL_ERROR enables visible60s fallback; hidden suppresses fallback; cleanup removes timer | Passed: test-supabase-egress-refresh.mjs executes actual effect with controllable socket/timer |
| EG-02 | Kitchen active request filters pending/acknowledged at server; default adapter remains full list for other callers | Passed: actual adapter executed with query double |
| EG-03 | Kitchen history query only executes when explicitly open; terminal mutation removes active rows; history receives updates only while open | Query gating passed in behavior test; mutation/UI/source checked, kitchen bell/delivery regressions passed; signed-in visual pending |
| EG-04 | Identical session content key stable; changed content invalidates; Today snapshot read scoped to current day | Passed: actual key expression executed; scope source verified |
| EG-05 | Admin20events coalesce to1read after400ms; scope cleanup cancels pending read | Passed: actual guard expression and burstGuard executed |
| EG-06 | Report joined/partial events coalesce to1ledger read after400ms; full snapshot/day update local state; DELETE/partial fallback reads | Passed: actual subscription callbacks executed |
| EG-07 | Sequential/concurrent helpers share1branches read within context; new flow/scope rereads; default parallel helpers share in-flight read | Passed: real attendance helpers executed with query double |
| EG-08 | Valid delivery/notification/shift recovery/report/revenue flows preserved | Passed: kitchen-idle-bell, supply-request-delivery-schedule, shift-close-report-realtime, today-shift-open-recovery, management-daily-competition-realtime, sales-report-consistency; TypeScript passed |
| EG-09 | Legacy test failures distinguished from regressions | test-shift-realtime-reminders explicitly requires8000 polling, contradicts new user requirement: Needs Business Confirmation in reusable test tracking; direct user instruction already authorizes new behavior. Original test preserved. attendance-realtime-next-day shows identical9failures against HEAD baseline; unrelated source contracts preserved |

Harness uses transpiled actual effects/adapters and controllable timer/socket/query doubles. It does not measure Supabase production bytes or replace signed-in UI/multi-device verification. Full build result recorded in TEST_PROGRESS/SESSION_HANDOFF.

Expected savings, not production measurements:

- Today operations interval:450batches/hour→0with healthy socket; disconnected→60/hour (~87%fewer timer batches).
- Kitchen repeated response payload: proportion of terminal rows removed; e.g20active/1000total≈98%fewer rows per repeated read. History reads still transfer full permitted scope when opened/updated while open; LAN endpoint remains unchanged and filters response locally, so this server-egress saving applies to Supabase mode.
- Today snapshot: identical-session refreshes no longer query; relevant reads limited to1day rather than all days. Depends on actual snapshot count/size.
- Admin/Report debounce: n events inside400ms quiet-window burst→1read (5events≈80%,20events≈95%fewer burst reads). Spaced events still read; not a cap on long-running event traffic.
- Report complete snapshot/day payload:0follow-up reads for these events; partial/join/DELETE still reconcile.
- Branch reads in a batch: k→1 (~50–80%for2–5calls); no stale TTL cache across flows.
