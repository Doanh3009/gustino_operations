# Local versus active deployment — updated 2026-07-16

## Evidence boundary

- The prior production baseline loaded `index-BFBcAEpk.js`/`index-COVblSS-.css` and contained the BUG-021/022 receipt-cap/stale-finalization behavior.
- Current production deployment `dpl_GEMYw5wPiK7fTSK5j6wjG9WBbgAX` is `READY` and aliased to `https://gustino-operations.vercel.app`.
- Read-only production `index.html` returns HTTP 200 and loads `index-DOyCiHFj.js` plus `index-CMcoy5E8.css`; the live JS contains the intended Supabase project and product tombstone contract, while the Admin chunk contains shift reconciliation.
- Applied only the two targeted additive policy/RPC migrations. No SQL restore, seed, purge, attendance correction, webhook, synthetic business write or manual cron invocation was performed. Post-deploy guards confirm profiles, attendance, 2026-07-16 sales and stock history remain at or above their verified baselines.

## Material differences

| Area | Prior deployment | Current production deployment |
|---|---|---|
| Attendance GPS | Does not contain the new 2026-07-15 fresh/best-of-two implementation | Forbids cached positions, retries one coarse sample, selects the better coordinate, retains the 150 m hard ceiling |
| Inventory count voucher | Does not contain the new dedicated current-stock/image action | Lists positive current stock, shows a read-only `Tồn hiện tại` column, saves/shares the voucher image; physical count fields are unchanged |
| Attendance loading | Predates the latest tab-scoped data plan/status UI | Loads only datasets required by the active tab, coalesces refresh and shows realtime/LAN sync status without a spinner loop |
| Disabled buttons | Every disabled primary/secondary/mini button inherits a rotating pseudo-element and progress cursor, even when idle | Disabled prerequisite/empty-state buttons are static; real async actions keep their explicit “Đang…” text |
| Attendance XLSX | Predates the owner correction | Removes all unrequested breakfast/lunch/dinner columns; selected date-range filename remains |
| Competition | Predates the owner correction | Hides registered hours and removes the manager-only query/subscription used only for that display |
| Attendance photo | Predates the restored legacy stamp | Restores dark legacy hierarchy plus address, GPS coordinates and accuracy |
| Sales/report consistency | Confirmed `.limit(120)` and stale rendered-model finalization | Paginates authorized receipts and reloads the authoritative branch/date ledger immediately before finalization |
| Automatic day close | No deployed protected scheduled endpoint from the local batch | Contains protected 00:00 UTC+7 schedule, configured server secrets and completed-day POS snapshot reconstruction; first scheduled execution is pending |
| Report/Zalo UI | Predates the latest compact toolbar/native fallback | Scope dropdown, compact actions, strict n8n acknowledgement diagnostics and native `Chia sẻ ảnh Zalo` fallback |
| Report/archive phone UI | Predates the final archive polish | Removes developer-facing notes, prevents horizontal overflow, normalizes month/date/select/button sizing, and reads only the selected month |
| Inventory overview | Still shows the four count cards in the owner screenshot | Removes Phiếu nhập/Phiếu xuất/Sắp hết/Phiếu kiểm kê count cards while preserving low-stock warning, stock list and inventory functions |
| Order image export | Uses the earlier detached data-URL path | Captures JPEG as Blob, prefers native Share Sheet and falls back to an attached object-URL download |
| Manager receipt access | Manager can open the branch-invoice drilldown | Manager retains aggregate revenue/hourly metrics but cannot open branch invoice rows; admin retains the drilldown |
| Competition names | Long employee names can be ellipsized/clipped | Full employee and leader names wrap safely on desktop and phone |
| Leader competition | Uses the leader profile's personal receipt revenue | Uses total POS revenue inside each branch/date shift session owned by that leader, compared with the unchanged leader KPI target |
| Payroll KPI aggregation | Direct POS can be evaluated per receipt and the detail table can omit those sales | Groups allocation-linked and direct POS once by date × branch × employee before daily/weekly reward functions; the detail table mirrors the same daily source |
| Frontend load | Predates the latest lazy/scoped-load batch | Business pages are lazy chunks; focused management and attendance fetch only relevant datasets |
| Manager inventory | Predates the latest overview presentation | Current-stock/risk/movement overview by branch with clearer manager presentation |
| Manager inventory branch detail | Uses inline expanding branch rows; a long SKU block can push the remaining branches far below the viewport | Local 2026-07-16 build keeps all branch cards visible, then renders one selected warehouse detail panel with SKU threshold/status and waste attention below the full grid |
| Data completeness | Supply requests, cumulative stock and LAN POS retain older fixed/unpaged read paths | Stable paged stock/supply reads; LAN no longer cuts requests or POS at 80/120/1,000 rows |
| Configured inventory SKU | Count voucher can depend on the hardcoded product array | Count voucher follows configured SKU refreshes and safely renders custom positive-stock items |
| Critical load errors | Several management/handover reads can appear as empty data after an API error | Existing error banners receive the failure and prior valid state is retained; Handover cannot silently treat failed POS as zero sales |
| Business date | Several local/LAN paths use the UTC date before 07:00 UTC+7 | Client uses the shared local date helper and LAN uses an explicit UTC+7 date; Supabase POS delete RPC remains blocked pending migration approval |
| Shift warehouse reconciliation | Raw `sale_out` can remain empty while POS is active and handover balances contain the real opening/closing stock | Per-shift view derives official closed-shift Out from opening + additions − closing − waste and compares it with converted POS; open shifts remain explicitly provisional |
| Deleted system SKU | A cloud tombstone is discarded before cache merge, so the built-in SKU can reappear in inventory | Tombstones remain in shared cache state and exclude the SKU from stock, inbound, processing, packing and POS while old documents retain product metadata |

## Released changes — 2026-07-16 attendance/report/order batch

| Area | Prior production | Current production |
|---|---|---|
| Active-user heartbeat 403 | Existing-row upsert can return 403 for non-Admin because own SELECT is missing | Additive own-row-or-Admin SELECT migration installed; catalog verification passed and a signed-in retry remains pending |
| Attendance correction | Admin can add missing historical attendance but cannot correct the times of an existing record from the list | Admin has an on-web per-shift list and audited correction RPC; the authoritative record feeds the existing attendance/payroll calculations |
| KPI summary | Shows the two owner-rejected Doanh số/Hao hụt cards above employee KPI | Both cards are removed; employee/leader KPI data and formulas remain |
| Stock report image | Variable-size JPEG with small reporter and no prominent branch | Dedicated 1080×1920 PNG poster with branch/reporter identity and readable stock table |
| Inventory-count image | Captures the editable A4-like form, producing large blank space/soft text | Dedicated 1080×1920 PNG poster; interactive form and stored count fields are unchanged |
| Order entry/export | Large entry cards and variable-size JPEG report | Table-like entry surface plus fixed 1080×1350 2× PNG report |
| Inventory-count sizing | Fixed-height poster can leave a long white tail with only a few SKU rows | Content-driven PNG height; compact white-paper/green-accent/dark-table layout matching the owner-supplied reference |

## Verification status

The deploy-polish, BUG-051 through BUG-058 and attendance/report/order batches pass focused and related suites, app TypeScript, the 696-module build and the production Supabase bundle guard. Deployment `dpl_GEMYw5wPiK7fTSK5j6wjG9WBbgAX` is live with assets `index-DOyCiHFj.js`/`index-CMcoy5E8.css`; runtime schema is complete and BUG-057/058 require no new migration. Profiles, attendance, registrations, stock, reports and shift sessions remained unchanged through deploy. One explicitly disclosed 33,000đ POS receipt deletion occurred concurrently; the deploy artifact has no database write and no migration ran, while the existing receipt-delete RPC lacks actor/time audit. Automatic midnight close remains deployed with Sensitive Production secrets. The broader suite retains blockers BUG-002/003/038. Physical HTTPS GPS accuracy, rendered role/mobile flows, native share, signed-in heartbeat and live n8n/Zalo execution remain pending because the in-app Browser/device surface is unavailable.
