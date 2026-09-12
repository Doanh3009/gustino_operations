# MOD-07 — Admin revoke/delete payslips (2026-09-12)

| Case | Expected | Evidence/status |
| --- | --- | --- |
| Non-Admin revoke/delete | Rejected before database query | Passed: test-payslip-revoke-delete.mjs; six roles |
| LAN or unsaved slip | Clear error, no mutation | Passed: adapter mock |
| Revoke saved slip | Clear publication/viewed fields, retain salary values | Passed: adapter mock |
| Delete saved slip | Delete payroll_entries by exact ID only | Passed: adapter mock |
| Failed mutation | Error propagated, no success state | Passed: adapter mock + UI source |
| Save then remove | Save returns persisted ID/publication state | Passed: adapter mock |
| Cancel confirmation | No revoke/delete query | UI source verified; signed-in click pending |
| Employee viewing revoked/deleted slip | Removed on 30-second/focus/visibility refresh | Source verified; isolated signed-in DB/UI pending |
| Existing payroll/KPI | Original contracts continue passing | Passed: Admin, delivery, timesheet scripts |
| Route permissions | Existing role access retained | Passed: 144 role/page checks |

No real payroll rows were modified. Migration/deployment remain pending.

## 2026-09-12 — Save outcome visibility

- Confirmed source bug: outcome banners outside dialog are covered by modal backdrop.
- Admin contract now verifies success/status and error/alert live inside sticky dialog footer; Passed. Delivery and revoke/delete adapter regressions Passed.
- Visual check of actual save success/failure on desktop/mobile remains pending because in-app Browser is unavailable. No database mutation.

## Employee confirmation (2026-09-12)

- Passed adapter: own published slip confirms via RPC/server timestamp; other employee/Admin/unpublished rejected; missing RPC/error is failure, never false success.
- Passed contract: helper sentence removed, footer confirmation button, SQL ownership + publication timestamp guard, idempotent timestamp; publish/revoke clear confirmation.
- Pending isolated DB: confirm twice preserves first timestamp; other employee cannot confirm; revoked/re-published older version rejected; existing salary fields unchanged.

## Viewed notification cleanup (2026-09-12)

- Passed adapter: missing RPC is error/no event; successful own acknowledgement emits entry ID/timestamp.
- Passed source contract: badge and dropdown share unread set, stale reads cannot overwrite newer shell refresh, selected fallback slip also acknowledged, failure visible.
- Pending signed-in DB/phone: badge decreases and row disappears after open/navigation; own published slips still reopen; other employee cannot mark viewed; refresh retains state.

## Employee Lương menu (2026-09-12)

- Passed source contract: Lương entry immediately follows Chấm công, opens my-payslips for existing authorized staff/shift_leader/cashier roles.
- Existing monthly list/detail/viewed/confirmation tests remain green. Signed-in desktop/mobile sidebar click and own monthly row access remain pending.

## Employee month filter (2026-09-12)

- Passed contract: month input, reset, filtered list/detail, notification period preservation.
- Pending signed-in UI: pick month with slip / without slip / reset all; refresh retains month and no hidden slip is marked viewed; phone picker/layout.

## Visible month value (2026-09-12)

- Passed contract: selector renders explicit all-month option and selected MM/YYYY label, replacing empty native month input. Existing filtered-list/detail/notification checks pass.
- Pending phone UI: value visible before focus, open/choose period, reset all; no data mutation.
