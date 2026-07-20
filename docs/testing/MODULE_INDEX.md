# Business Module Index

Last updated: 2026-07-17. This is the source-backed inventory and remains subject to discovery refinement.

| ID | Module | Primary source evidence | Risk | Status |
|---|---|---|---|---|
| MOD-01 | Authentication, session lifecycle, account activation | `App.tsx`, `LoginPage.tsx`, `LauncherPage.tsx`, Supabase Auth/function | Critical | In progress — BUG-049 production Supabase bundle outage fixed/verified; authorization blockers remain |
| MOD-02 | Authorization, roles, page/branch/data scope | `lib/access.ts`, `App.tsx`, RLS migrations, role QA scripts | Critical | In progress — BUG-003 Critical and BUG-002 High blocked; UI integration blocked |
| MOD-03 | Branch configuration and lifecycle | `lib/branches.ts`, `AdminPage.tsx`, branch migrations | High | In progress — static controls checked; BUG-031 closed; live integration pending |
| MOD-04 | Employee/account administration | `AdminPage.tsx`, `manage-employee`, profile migrations | Critical | In progress — isolated LAN create/login/reset/deactivate and browser flow pass; BUG-068 fixed locally; Edge/Auth production verification pending |
| MOD-05 | Scheduling and registrations | `AttendancePage.tsx`, schedule migrations | High | In progress — static controls/date guard checked; business/integration pending |
| MOD-06 | Attendance, selfie, geotag, adjustments | `lib/attendance*.ts`, attendance pages/components/migrations | Critical | In progress — BUG-070 fixed locally with retry/read-back; 9 stale open rows preserved for owner review; production/device verification pending |
| MOD-07 | Payroll, KPI, commission | `lib/payroll.ts`, `lib/commission.ts`, admin/records pages, migrations | High | In progress — BUG-062 decimal-hour clarity and BUG-064 revenue-rank/reward explanation deployed without formula changes; exact employee data check plus monthly/weekly semantics/finalization lock still need confirmation |
| MOD-08 | Shift opening/closing and bag handover | `lib/shiftLedger.ts`, `ShiftHandoverPage.tsx`, close RPC migrations | Critical | In progress — isolated LAN browser flow passes both shifts plus POS/handover/report; cloud/multi-device integration pending |
| MOD-09 | Sales/POS receipts and staff history | `SalesPage.tsx`, `lib/salesReceipts.ts`, POS migrations | Critical | In progress — complete reads/errors fixed; BUG-038 DB timezone blocked; production verification pending |
| MOD-10 | Inventory movements and stock reports | `InventoryPage.tsx`, focused inventory in `AdminPage.tsx`, `lib/store.ts`, inventory migrations | Critical | In progress — BUG-055/057/060/061 deployed; numeric clarity and period-wide sale-out/handover live; visual/workbook verification pending |
| MOD-11 | Kitchen production/batches | `KitchenPage.tsx`, store/schema/migrations | High | In progress — desired delivery/order-date visibility and classified history filters active; BUG-059 idle ringtone remains deployed pending physical audible verification |
| MOD-12 | Supply requests/orders | `OrdersPage.tsx`, `lib/supplyRequests.ts`, request migrations | High | In progress — owner-requested receiving date/period plus kitchen confirmed/sent wording active; existing status transitions retained; live role/UI pending |
| MOD-13 | Daily shift report/finalization/archive | `ReportPage.tsx`, `ReportArchivePage.tsx`, `lib/reportSync.ts`, `lib/reportDeliveryIntent.ts`, report APIs/RPCs | Critical | In progress — owner-defined Ca 1/Ca 2 close semantics and pending Zalo-intent seam are deployed/live-marker verified; external connection, signed-in UI and first midnight cron verification pending |
| MOD-14 | Revenue/restaurant/manager dashboards | dashboard pages, `lib/revenue.ts`, `lib/shiftCompetition.ts` | High | In progress — classified daily/monthly/leader ranking deployed and preserves existing revenue aggregation; visual/live-data pending |
| MOD-15 | Products/master data/soft deletion | `lib/products.ts`, admin/inventory pages, product migrations | High | In progress — BUG-069 fixed locally; cake linkage/tombstone regressions pass; historical movements intact |
| MOD-16 | Control center/audit/reconciliation | `ControlCenterPage.tsx`, control-center migration | High | In progress — static destructive/sync controls checked; dynamic RBAC enforcement needs business confirmation |
| MOD-17 | Export/report files (CSV/XLSX/PDF/image) | attendance/report/order pages, ExcelJS/jsPDF/html2canvas | Medium | In progress — inventory export has unambiguous numeric formatting plus period-wide handover/sale-out, complete ledger, current stock and count-voucher sheets; actual workbook-open/device verification pending |
| MOD-18 | Reverse geocoding and degraded external-service behavior | `api/reverse-geocode.ts`, attendance flow | Medium | In progress — source regression passes; physical HTTPS GPS pending |
| MOD-19 | Local demo/LAN synchronization and persistence | `lib/supabase.ts`, `lib/store.ts`, LAN/dev scripts | High | In progress — syntax/data completeness checked; BUG-003 auth blocked; integration pending |
| MOD-20 | Frontend load performance and perceived responsiveness | `App.tsx`, lazy-route recovery, `GlobalLoadingOverlay.tsx`, management/attendance pages, export helpers | High | In progress — BUG-066 lazy recovery and BUG-067 delayed network-only loading fixed locally; production/UI verification pending |

## 2026-07-20 status refinement

- MOD-04/MOD-07: employee sales detail now exposes daily revenue chart/table; KPI guide explains existing day-based calculations and uses the shared filters. Local/type/build passed; visual verification pending.
- MOD-10: manual sale-out remains confirmable; the corrected local fix defaults sub-kilogram entries to grams and marks unsellable packing residue without changing physical quantity. Menu SKUs are visibly separated. BUG-091 RPC migration-order drift is blocked pending direct schema approval.
- MOD-12/MOD-17: Admin purchasing is read-only and exports filtered Excel. Workbook-open verification pending.
- MOD-06/MOD-18: reverse-geocode providers now race within a client timeout longer than each provider bound; handler/source regressions pass, while physical HTTPS GPS remains pending.
- MOD-20: scoped overflow hardening, mobile-header logo removal and competition-table tablet/card treatment passed source/type regressions; Browser is unavailable for visual verification.

Priority rationale: MOD-02 is first because authorization failures can expose or mutate cross-role/cross-branch business data and invalidate every downstream module test.
