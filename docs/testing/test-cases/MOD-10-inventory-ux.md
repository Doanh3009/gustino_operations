# MOD-10 — Inventory quantity and mobile readability

Status: in progress; visual and live-data verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD10-TC-ZERO-01 | Floating negative zero | Quantity renders as zero, never `-0.00` | `test-report-inventory-ux.mjs` Passed; BUG-007 closed |
| MOD10-TC-UNIT-01 | Enter kg or g | Selected unit converts to canonical kg without changing stock formulas | Static/type test Passed |
| MOD10-TC-WARN-01 | Decimal input guidance | Warning explains comma/decimal and gram entry | Static test Passed |
| MOD10-TC-LIST-01 | Inventory list | No stock-level meter; small kg values are readable in grams | Static test Passed; mobile visual pending |
| MOD10-TC-COUNT-IMAGE-01 | Open inventory-count voucher and send it to the report group | Voucher lists only positive current stock, shows current quantity in a dedicated read-only column, and can be saved/shared as an image without changing the physical-count inputs | `REPORT_INVENTORY_UX_OK` + TypeScript Passed; visual/device share pending |
| MOD10-TC-DATA-01 | A branch accumulates more stock movements than one Supabase response page | Current stock is calculated from the full authorized cumulative ledger in a stable order | Pre-fix failed; `DATA_PAGINATION_CONSISTENCY_OK` and TypeScript Passed after stable 500-row pagination |
| MOD10-TC-SKU-01 | Admin-configured/custom SKU has positive stock and the count form opens or receives a realtime product refresh | Voucher includes the SKU, uses its configured name/unit and does not crash or reset entered count values | Pre-fix failed; `REPORT_INVENTORY_UX_OK` and TypeScript Passed after configured-product source alignment |
| MOD10-TC-DATE-01 | Inventory page remains open across local midnight or opens before 07:00 UTC+7 | Default report/filter date is the local business date, never the prior UTC date | BUG-037 fixed; only the unrelated Supabase POS migration assertion remains in `test-business-date-contract.mjs` |
| MOD10-TC-CARD-01 | Open current-stock mode | The four large Phiếu nhập/Phiếu xuất/Sắp hết/Phiếu kiểm kê count cards are absent; low-stock alert and current-stock list remain | Direct owner change; `DEPLOY_UI_BUSINESS_POLISH_OK` + inventory regression Passed |
