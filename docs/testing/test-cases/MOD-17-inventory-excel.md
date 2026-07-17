# MOD-17 — Inventory Excel number formatting

Status: in progress; separator and single-day export defects deployed, visual/workbook verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD17-TC-XLSX-01 | Export the inventory workbook with integer, fractional and four-digit quantities | Every numeric quantity remains a numeric Excel cell and uses one decimal separator only; grouping separators must not be mixed into the same value | Passed source/build/live-bundle verification: `INVENTORY_EXCEL_NUMBER_FORMAT_OK`; six quantity groups share `0.####` and POS revenue uses `0`. Production `dpl_CV4n9oaG27ciC3KQRCEYELXNA1T7` serves the corrected chunk; actual workbook-open verification remains pending. |
| MOD17-TC-XLSX-02 | Select a multi-day/month inventory period, inspect “Xuất bán và tồn bàn giao”, then export Excel | The UI and both handover/sale-out sheets must include every selected date and show the date on each shift row | Passed source/build/live-bundle verification: `INVENTORY_EXPORT_DATE_RANGE_OK`; inclusive range filtering, two in-section date controls, per-shift business dates and period sheet titles are live. Visual/workbook verification remains pending. |
