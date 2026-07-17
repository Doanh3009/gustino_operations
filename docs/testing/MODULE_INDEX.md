# Business Module Index

Last updated: 2026-07-17. This is the source-backed inventory and remains subject to discovery refinement.

| ID | Module | Primary source evidence | Risk | Status |
|---|---|---|---|---|
| MOD-01 | Authentication, session lifecycle, account activation | `App.tsx`, `LoginPage.tsx`, `LauncherPage.tsx`, Supabase Auth/function | Critical | In progress — BUG-049 production Supabase bundle outage fixed/verified; authorization blockers remain |
| MOD-02 | Authorization, roles, page/branch/data scope | `lib/access.ts`, `App.tsx`, RLS migrations, role QA scripts | Critical | In progress — BUG-003 Critical and BUG-002 High blocked; UI integration blocked |
| MOD-03 | Branch configuration and lifecycle | `lib/branches.ts`, `AdminPage.tsx`, branch migrations | High | In progress — static controls checked; BUG-031 closed; live integration pending |
| MOD-04 | Employee/account administration | `AdminPage.tsx`, `manage-employee`, profile migrations | Critical | In progress — destructive/self-delete guards checked; live role/API pending |
| MOD-05 | Scheduling and registrations | `AttendancePage.tsx`, schedule migrations | High | In progress — static controls/date guard checked; business/integration pending |
| MOD-06 | Attendance, selfie, geotag, adjustments | `lib/attendance*.ts`, attendance pages/components/migrations | Critical | In progress — BUG-062 duration/search and BUG-063 audited exact-record deletion deployed; signed-in deletion/audit, iPhone and visual integration pending |
| MOD-07 | Payroll, KPI, commission | `lib/payroll.ts`, `lib/commission.ts`, admin/records pages, migrations | High | In progress — BUG-062 decimal-hour clarity and BUG-064 revenue-rank/reward explanation deployed without formula changes; exact employee data check plus monthly/weekly semantics/finalization lock still need confirmation |
| MOD-08 | Shift opening/closing and bag handover | `lib/shiftLedger.ts`, `ShiftHandoverPage.tsx`, close RPC migrations | Critical | In progress — automatic flow checks pass; integration pending |
| MOD-09 | Sales/POS receipts and staff history | `SalesPage.tsx`, `lib/salesReceipts.ts`, POS migrations | Critical | In progress — complete reads/errors fixed; BUG-038 DB timezone blocked; production verification pending |
| MOD-10 | Inventory movements and stock reports | `InventoryPage.tsx`, focused inventory in `AdminPage.tsx`, `lib/store.ts`, inventory migrations | Critical | In progress — BUG-055/057/060/061 deployed; numeric clarity and period-wide sale-out/handover live; visual/workbook verification pending |
| MOD-11 | Kitchen production/batches | `KitchenPage.tsx`, store/schema/migrations | High | In progress — status-button mapping checked; BUG-059 idle ringtone fixed/deployed with physical-device audible verification pending; cancellation reason needs business confirmation |
| MOD-12 | Supply requests/orders | `OrdersPage.tsx`, `lib/supplyRequests.ts`, request migrations | High | In progress — workflow/history/status controls pass; owner-requested table-like entry UI and fixed 4:5 professional image export are in progress; live role/UI pending |
| MOD-13 | Daily shift report/finalization/archive | `ReportPage.tsx`, `ReportArchivePage.tsx`, `lib/reportSync.ts`, `lib/reportDeliveryIntent.ts`, report APIs/RPCs | Critical | In progress — owner-defined Ca 1/Ca 2 close semantics and pending Zalo-intent seam are deployed/live-marker verified; external connection, signed-in UI and first midnight cron verification pending |
| MOD-14 | Revenue/restaurant/manager dashboards | dashboard pages, `lib/revenue.ts`, `lib/shiftCompetition.ts` | High | In progress — classified daily/monthly/leader ranking deployed and preserves existing revenue aggregation; visual/live-data pending |
| MOD-15 | Products/master data/soft deletion | `lib/products.ts`, admin/inventory pages, product migrations | High | In progress — configured SKU inventory fix verified; live realtime pending |
| MOD-16 | Control center/audit/reconciliation | `ControlCenterPage.tsx`, control-center migration | High | In progress — static destructive/sync controls checked; dynamic RBAC enforcement needs business confirmation |
| MOD-17 | Export/report files (CSV/XLSX/PDF/image) | attendance/report/order pages, ExcelJS/jsPDF/html2canvas | Medium | In progress — inventory export has unambiguous numeric formatting plus period-wide handover/sale-out, complete ledger, current stock and count-voucher sheets; actual workbook-open/device verification pending |
| MOD-18 | Reverse geocoding and degraded external-service behavior | `api/reverse-geocode.ts`, attendance flow | Medium | In progress — source regression passes; physical HTTPS GPS pending |
| MOD-19 | Local demo/LAN synchronization and persistence | `lib/supabase.ts`, `lib/store.ts`, LAN/dev scripts | High | In progress — syntax/data completeness checked; BUG-003 auth blocked; integration pending |
| MOD-20 | Frontend load performance and perceived responsiveness | `App.tsx`, `GlobalLoadingOverlay.tsx`, management/attendance pages, export helpers | High | In progress — lazy/scoped/coalesced loads and preloaded/pre-paint random 1/2/4 Capy interaction loading are deployed and pass regression/build/live HTTP checks; browser timing/visual/disconnect verification pending |

Priority rationale: MOD-02 is first because authorization failures can expose or mutate cross-role/cross-branch business data and invalidate every downstream module test.
