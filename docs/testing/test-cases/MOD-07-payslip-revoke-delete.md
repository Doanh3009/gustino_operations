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
