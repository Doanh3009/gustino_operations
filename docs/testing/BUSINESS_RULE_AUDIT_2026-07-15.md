# Business-rule audit — 2026-07-15

This audit compares active source behavior with `BA.md`, current migrations and `CODEMAP.md`. It does not reinterpret business rules. Confirmed implementation defects were fixed only where the existing rule was unambiguous; conflicts and missing contracts are left for owner confirmation.

## Verified current controls

| Area | Source-backed result | Status |
|---|---|---|
| Login/session UI | Inactive profile/branch is rejected and loading is released | Static guard Passed; database inactive-session guard remains BUG-002 |
| POS deletion UI | Staff sees delete only for own/current-day receipt; manager roles retain branch-management path; confirmation is required | Guard Passed; UTC+7 Supabase RPC mismatch remains BUG-038 |
| Orders/Kitchen state buttons | Positive finite quantity required; cancel/delete confirmations present; Kitchen buttons map `pending → acknowledged → fulfilled` | Guard Passed; cancel reason is an unresolved BA gap below |
| Inventory writes | Shortage and destructive-delete confirmations are present; current stock uses the full paginated ledger; configured SKU count voucher no longer crashes/omits a positive-stock SKU | Focused regressions Passed |
| Admin destructive controls | Account deletion is two-step and self-delete is blocked; branch/test-data destructive paths use confirmations | Static guard Passed; live role/UI checks pending |
| Management autosave | Payroll/default/low-stock sync failures surface in existing banners instead of looking successful | BUG-032 closed |
| Branch fallback | Direct branch-upsert failures report the actual direct error | BUG-031 closed |
| Critical business reads | Admin, Handover, Dashboard and manager POS no longer convert failed POS/attendance/request/report/employee reads into false empty state | BUG-039 closed; live network/RLS execution pending |
| Dashboard load | Unused all-session fetch/state removed while realtime invalidation remains | BUG-040 closed; browser timing pending |
| Production data source | Live bundle contains the intended Supabase project/public anon key; manager and Gold Coast shift-leader RLS simulations can read today's authorized users, receipts, registrations, attendance, sessions and stock | BUG-049 closed; post-deploy database audit confirms rows were never deleted |
| Automatic day close | Protected 00:00 UTC+7 endpoint targets only the completed previous date/older stale dates and rebuilds archive revenue/sold/employee/proof fields from completed-day data | Deployed/configured; first real scheduled execution pending |
| Active users and attendance adjustments | Both RLS-enabled cloud tables are live; frontend no longer stores or reads device-local fallback data for these synchronization flows | BUG-050 closed and production verified |

## Needs Business Confirmation

| Topic | Current source | Conflicting requirement/evidence | Decision required before implementation |
|---|---|---|---|
| Manager access to Orders and Report Archive | Both routes/nav items are admin-only | `BA.md` §2.3 says managers process supply requests; `CODEMAP.md` §28 says manager retains “Đặt hàng, Kho báo cáo” | Confirm whether manager must regain one or both routes, then align UI, route guards and database policies together |
| Dynamic RBAC enforcement | Permission checkboxes persist `control_permission_matrix`; `canAccessPage()` and RLS remain static role rules; “Lưu audit” only writes an audit entry | `BA.md` §2.1 requires module/action permissions; UI itself says backend/RLS synchronization is still needed | Define authoritative permission model, default matrix, role/group behavior and RLS enforcement |
| Kitchen cancellation reason | Cancel button writes only status `cancelled`; request model/table has no dedicated cancellation reason | `BA.md` §6.1 requires cancel/reject with reason | Define required/optional reason, storage field, who can edit/view it and audit behavior |
| POS cancel/edit reason and audit | UI uses confirmation then `delete_pos_receipt`; no reason parameter or dedicated POS audit entry | `BA.md` §4.2 requires reason and audit; current POS inventory behavior has since evolved, so the old stock-return wording cannot be applied blindly | Confirm current cancellation/edit flow and audit retention before any RPC/schema change |
| Large inventory variance approval | Count voucher saves count movements immediately; no threshold or approval state | `BA.md` §5.6 requires threshold warning and manager approval for large variance | Define threshold by unit/SKU/branch, approval state, who may approve, and whether stock changes before approval |
| Payroll period finalization/lock | Payroll entries autosave; no period status, finalize, lock or unlock permission | `BA.md` §8.3 requires close-by-period and lock after close | Define payroll period lifecycle, unlock roles, adjustment audit and export behavior |
| KPI monthly/weekly reward semantics | Payroll currently pays daily bonus plus weekly bonus; six achieved days in one week returns 200,000 because `perfectDays` is currently identical to achieved days. `monthlyKpiBonus()` contains tiers but payroll deliberately keeps `monthlyBonus = 0` | `CODEMAP.md` records daily/weekly as the active contract and monthly as zero, but the repository has no approved definition distinguishing a “perfect” day or authorizing the dormant monthly tiers | Confirm whether six ordinary achieved days qualify for 200,000, what makes a day “perfect”, and whether/when monthly tiers must be activated before changing these formulas |
| POS payment-method capture | `SalesPage.tsx` saves every receipt as `cash`; all 22 production receipts for 2026-07-15 consequently report cash | Revenue totals remain correct, but the database cannot currently support a meaningful cash-versus-QR reconciliation | Confirm the accepted payment methods and whether staff must select one per receipt before changing the UI/data behavior |

## Production revenue reconciliation — 2026-07-15

The linked production audit in `scripts/db_audit_revenue_reconciliation_20260715.sql` ran inside `begin transaction read only` and rolled back. It found:

- Chain receipt headers and item lines both total 1,332,000đ; difference is 0đ.
- Gold Coast Nha Trang: 538,000đ, 7 units, 6 receipts.
- Lotte Mart Vũng Tàu: 451,000đ, 10 units, 10 receipts.
- Lotte Mart 23/10: 343,000đ, 7 units, 6 receipts.
- Zero receipt/item mismatches, receipts without lines, zero-value receipts, duplicate receipt codes, invalid `line_total` calculations and allocation mismatches.
- Compared with the earlier same-day audit of 1,210,000đ, later receipt entry added 122,000đ: 89,000đ at Lotte 23/10 and 33,000đ at Lotte Vũng Tàu.
- Gold Coast's six receipts are all attributed to one seller while seven people checked in. This can indicate shared seller selection at the POS, but it does not prove that a checked-in employee missed a physical sale.

Conclusion: no internal revenue-calculation defect is confirmed. A claimed difference from real-world takings must be checked against sales that were never entered or were attributed to another selected seller; the application cannot infer an unrecorded sale from its own ledger.

## Confirmed blockers not changed

- BUG-002: inactive profiles are not enforced consistently in shared database authorization helpers.
- BUG-003: LAN protected routes can trust spoofable identity headers without a valid server session.
- BUG-038: Supabase same-day POS deletion uses database `current_date`, not the UTC+7 business date.
- Automatic midnight close is deployed/configured, but its first real scheduled execution is still pending. No manual catch-up was invoked because seven older open operation days are in scope.

## UI evidence boundary

Static analysis covered all 195 native buttons (189 reachable from active `App.tsx`) and found no missing/no-op action wiring or invalid form-submit wiring. The required in-app Browser returned no controllable runtime, so real click, rendered layout, disabled-state, multi-role and mobile-viewport execution remains Blocked and is not claimed Passed.
