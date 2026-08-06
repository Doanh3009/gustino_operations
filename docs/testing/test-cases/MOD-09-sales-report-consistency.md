# MOD-09 — POS receipts and final-report consistency

Status: in progress; BUG-021/022 fixed in code, production verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD09-TC-COUNT-01 | Branch has more than 120 receipts in one business day | Report/leader view loads every receipt allowed by the same branch/date/RLS query; no oldest receipt is silently truncated | `SALES_REPORT_CONSISTENCY_OK`; stable 500-row pagination; production verification pending |
| MOD09-TC-FINAL-01 | Employee records the final one-bag receipt immediately before leader finalizes | Final snapshot is built from an authoritative fresh ledger read and contains the final receipt even if realtime state has not arrived | `SALES_REPORT_CONSISTENCY_OK`; report/finalization regressions Passed; production verification pending |
| MOD09-TC-RULE-01 | Apply consistency fix | Prices, quantities, KPI/revenue formulas, seller identity, finalization gates, permissions and RLS remain unchanged | Focused regression and TypeScript Passed; no schema/contract change |
| MOD09-TC-LAN-01 | LAN branch exceeds 120 receipts/day or 1,000 receipts in selected range | Daily and range reads return every authorized matching receipt; LAN does not silently diverge from the Supabase path | Pre-fix failed; `SALES_REPORT_CONSISTENCY_OK` and `DATA_PAGINATION_CONSISTENCY_OK` Passed after cap removal |
| MOD09-TC-DATE-01 | Employee deletes an own receipt between 00:00–06:59 UTC+7 | “Today” is the UTC+7 business date in UI, LAN and Supabase | UI/LAN corrected; `test-business-date-contract.mjs` remains failed only for BUG-038 Supabase RPC migration (`Blocked — Requires Business Decision`) |
| MOD09-TC-ERROR-01 | POS receipt read or manager seller-list read rejects | Existing error UI is shown; prior state is retained instead of rendering false zero-sales/no-employees | Pre-fix failed; `CRITICAL_LOAD_FAILURE_VISIBILITY_OK` Passed |
| MOD09-TC-ADMIN-HISTORY-01 | Admin opens Overview for a period/branch containing POS bills | Recent history lists authoritative bills newest-first with timestamp, code, branch, seller, quantity and total; an empty state appears only when no matching bill exists | Pre-fix failed on inventory archive feed; `ADMIN_OVERVIEW_BILL_HISTORY_OK`, Admin ERP and TypeScript Passed after BUG-126 fix |
