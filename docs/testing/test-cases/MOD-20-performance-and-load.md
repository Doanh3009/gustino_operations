# MOD-20 — Frontend load performance and perceived responsiveness

Status: in progress; source/static reproduction active and browser timing pending.

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
