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
