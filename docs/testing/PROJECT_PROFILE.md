# Project Profile

Last updated: 2026-07-16

## Confirmed discovery

- Product: multi-branch restaurant operations web application.
- Frontend: React 19, TypeScript, Vite; hash-based page selection in `src/App.tsx`.
- Data/backend: Supabase Auth/PostgreSQL/RLS/RPC when configured; README states a localStorage demo fallback; LAN scripts/API also exist.
- Main source areas: `src/pages`, `src/lib`, `src/components`, `api`, `supabase/schema.sql`, `supabase/migrations`, `supabase/functions`, `scripts`.
- Authentication: Supabase session handling plus a LAN auth-token path in `src/App.tsx`.
- Roles confirmed from `src/lib/access.ts`: `admin`, `manager`, `shift_leader`, `staff`, `kitchen`.
- Authorization helpers: admin only; management = admin/manager; operations = shift leader; sales = shift leader/staff; kitchen = admin/kitchen. Database authorization also uses RLS policies and security-aware RPCs.
- External services observed: Supabase; Vercel reverse-geocode API; server-only n8n report webhook feeding the owner-configured Drive/Sheet/Zalo workflow; browser geolocation/camera; Excel/PDF/image export libraries.
- Existing verification assets: multiple `scripts/qa-*.mjs`, `scripts/smoke-business.mjs`, SQL audit/verify scripts, and Playwright Core.
- Frontend performance: authenticated business pages now use React lazy loading. Focused management routes have section-scoped fetch/realtime plans; attendance and management coalesce overlapping refreshes. ExcelJS remains an on-demand chunk rather than part of the initial page code.
- Current production deployment: `dpl_ANEHJkw8rJw6Ls62ETWekK8FMMie`, aliased to `https://gustino-operations.vercel.app`, serves `index-DMYHLV-_.js`, `index-DJLr6MCV.css` and `ReportPage-B8dx4RVC.js`. Live verification confirms the per-shift `pending_connection` Zalo intent and both scope-specific finalize labels; index, ReportPage and server-time return 200. Midnight auto-close remains protected/configured; its first real scheduled execution is pending.
- Manager inventory is rendered by the focused `AdminPage` inventory section. The 2026-07-16 local workspace groups quantities by kg/item unit (sub-kilogram display converts to g), adds exact-day `sale_out`, removes only the warning-threshold column, retains stock status and prepares a five-sheet workbook. Management uses table-specific realtime subscriptions plus a silent coalesced 30-second/focus/visibility reconciliation fallback. Stock movement signs/types, formulas and writes remain unchanged; live Browser/mobile and actual workbook-open verification remain unavailable.
- POS receipts and warehouse issue are separate current data flows. `saveSalesReceipt` does not write `stock_movements`; manual warehouse “Xuất bán” writes `sale_out`, and shift close can write it only from linked bag allocations. Production on 2026-07-16 has active POS sales but no allocation links/sale-out, so automatic POS inventory deduction remains a business decision rather than a confirmed display/realtime bug.
- Current local BUG-057 view reconciles those separate flows without writing either one: POS packages are converted through configured packing sources; closed shifts calculate Out from opening + additions − closing handover − waste, while open shifts show POS provisional. Production remains on the prior raw-sale-out view until owner approval.
- Active presence is cloud-only. Production migration `20260716_active_session_own_read.sql` installs own-row-or-Admin SELECT for upsert-on-conflict; catalog verification passed. One real signed-in heartbeat after the deployment remains pending before BUG-052 closure.
- Attendance/payroll share authoritative `attendance_records`; the owner-authorized Admin correction flow targets that table through an installed Admin-only audited RPC rather than a local correction store. Existing payroll/KPI formulas are unchanged. The current local BUG-054 UI defaults correction browsing to an exact day or one employee and paginates 20 rows without altering the RPC or report/export range.
- Shift-leader competition has a dedicated pure aggregation module (`lib/shiftCompetition.ts`): date-bounded leader sessions own all POS revenue inside their branch/business-date timestamp window. The management UI now classifies one shared ranking table as employee/day, employee/month or shift leader/month; this changes presentation/date selection only and remains distinct from payroll reward aggregation.
- Report finalization now records a per-shift `zaloIntent` inside the existing report snapshot rather than invoking an external sender from the finalize action. Sequence 1 maps only to `shift-1` and leaves the operation day open; sequence 2 maps to `shift-2` plus `day` and uses the existing atomic daily finalization. The intent is marked `pending_connection` as the explicit seam for the owner's collaborator; existing manual/integration modules remain separate.
- Report archive reads only the selected month; archive/date controls and order/report image exports use the same mobile-safe sizing/Blob patterns.
- Hash routes confirmed: launcher, dashboard, today, sales, my-records, report-archive, restaurant, report, inventory, handover, orders, attendance, management, manager-revenue, manager-business, manager-inventory, manager-attendance, manager-payroll, manager-requests, admin-accounts, control, kitchen; legacy `history` maps to orders and `admin` maps to management.
- Default pages confirmed: kitchen → kitchen; staff → sales; admin/manager → dashboard; shift leader → today.
- Permission matrix now enumerates all 22 canonical routes × 5 roles (110 planned UI checks) after BUG-001 test-infrastructure fix. These UI checks have not been executed in this session because the in-app Browser is unavailable.
- Manager branch scope has conflicting source evidence: migrations dated 2026-06-29 and 2026-07-01 explicitly make managers branchless/all-branch in `can_manage_branch`, while current `LoginPage.tsx` and `App.tsx` populate manager `branchIds` only from profile branch plus `manager_branch_assignments`, and dashboards filter by those IDs. No side is treated as authoritative without business confirmation.
- LAN authentication issues server-side random tokens at login and clients send them as Bearer tokens, but `actor()` falls back to caller-controlled `X-User-*` identity/role headers when a token is absent/invalid. Multiple routes trust `user.id`/`user.role` without `authenticated`; BUG-003 Critical is blocked pending authorization to change the API auth contract.

## Discovery still required

- Complete table/RPC/RLS inventory and effective migration order.
- Exact LAN API routes and persistence behavior.
- All external network calls and server-side equivalence for the UI role matrix.
- Test environment isolation, credentials, and whether current Supabase project is production-like.
- Measured automated coverage (no coverage claim exists).

## Repository state warning

The worktree already contained many modified and untracked application, migration, script, artifact, and data files before Testing Mode started. They are treated as user-owned and must not be reverted or overwritten.
