# MOD-20 — Frontend load performance and perceived responsiveness

Status: in progress; source/static reproduction active and browser timing pending.

## 2026-07-20 — responsive overflow hardening

- Common Admin/Inventory/Orders flex/grid children receive explicit `min-width: 0`/`max-width: 100%`; long user/data text wraps; wide tables and ledgers scroll inside their own containers.
- Removed only the mobile header Gustino logo requested by the owner. Desktop/sidebar logo remains.
- Employee daily-revenue chart has bounded height, horizontal scrolling and phone sizing.
- Evidence: focused owner regression, `MOBILE_HANDOVER_REPORT_OVERFLOW_OK`, fixed sidebar, role UI, operations performance, TypeScript and guarded build pass.
- Browser skill connection is unavailable (`[]`), so signed-in responsive screenshots are pending and no visual pass is claimed.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD20-TC-BUNDLE-01 | Open login/one business page | Unrelated heavy pages are not part of the initial synchronous import graph | `OPERATIONS_UX_PERFORMANCE_OK`; production build emits page chunks; browser timing pending |
| MOD20-TC-MGMT-01 | Open focused manager inventory | Only inventory-required datasets are requested; unrelated payroll, attendance, sales and request datasets are not fetched | Source/type Passed; live request-count timing pending |
| MOD20-TC-ATT-01 | Attendance realtime events overlap | Refreshes coalesce and the existing screen remains visible; no permanent loading overlay | Source/type Passed; multi-device integration pending |
| MOD20-TC-ATT-02 | Open or switch attendance tabs | Only the datasets required by the active tab are requested; the initial state is lightweight and visibly identifies automatic synchronization | `OPERATIONS_UX_PERFORMANCE_OK` + TypeScript Passed; browser timing pending |
| MOD20-TC-XLSX-01 | Export a multi-branch attendance workbook | Evidence URLs are resolved concurrently and cached across repeated branch sheets; XLSX reaches download/share without an endless busy state | Source/type/export regressions Passed; physical browser pending |
| MOD20-TC-VISUAL-01 | View manager inventory | Current-period risk and movement information is readable without opening every branch row | Static/CSS Passed; browser visual pending |
| MOD20-TC-XLSX-02 | Export any attendance date range | No unrequested breakfast/lunch/dinner columns are added to summary or detail sheets | Corrected source regression Passed; workbook UI verification pending |
| MOD20-TC-CAPY-01 | Trigger navigation, a form submit, button action, file/select change or related network request | A small centered loading window appears without changing the action; each loading session randomly selects exactly one of preloaded/decoded Capy images 1/2/4 before paint, holds until the user-related request settles (minimum 700 ms), and ignores later background polling | `CAPYBARA_LOADING_UI_OK`, app TypeScript, 204-button contract, idle-disabled regression and 697-module production build Passed; production HTML/asset HTTP verification Passed; in-app Browser visual/viewport check pending |
| MOD20-TC-CAPY-02 | View check-in/check-out reminders in AppShell and Today | Both attendance reminder surfaces use the transparent Capy camera image (reference image 3) and preserve the existing attendance rules/actions | Static asset/source contract, build and production asset HTTP verification Passed; signed-in reminder visual check pending |
| MOD20-TC-LOAD-03 | Background fetch shortly after an unrelated click/select | Polling/realtime reconciliation must not open a blocking global loading overlay; only explicit auth/lazy-page/local busy states remain | `CAPYBARA_LOADING_UI_OK`, `OPERATIONS_UX_PERFORMANCE_OK`; production visual verification pending |
| MOD20-TC-LAZY-01 | Log in from a tab kept open across a deployment | If the old main bundle requests an obsolete lazy page chunk, the app reloads once into the current bundle; persistent load failure shows a retry screen and never a blank root. Role routing and permissions stay unchanged. | Pre-fix `test-login-lazy-route-recovery.mjs` failed ten expected assertions; implementation active |
| MOD20-TC-ORDERS-01 | View compact sent-order rows on a narrow phone | The high-specificity compact selector is overridden inside the phone breakpoint; product/note text gets usable width and the status/action group moves below it | `DASHBOARD_ORDERS_MOBILE_RECOVERY_OK`, TypeScript and 712-module build Passed; Browser unavailable for visual capture |
## 2026-07-18 global-loading regression

- Pre-fix: every enabled click/submit/file/select calls `pulse()` and forces 700 ms loading even without async work.
- Expected: local/fast actions show no global overlay; only an associated fetch still pending after a short delay shows it; auth/lazy route loaders remain explicit.
- Automated case: `scripts/test-capybara-loading-ui.mjs` currently fails before the BUG-067 fix.
