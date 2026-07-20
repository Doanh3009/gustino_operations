# MOD-10 — Inventory quantity and mobile readability

Status: in progress; visual and live-data verification pending.

## 2026-07-20 — corrected kg/g issue, residue status, menu visibility and checked-RPC response

- `MOD10-TC-NEG-ISSUE-01` Corrected and Passed (source regression): a manual `sale_out` whose grouped quantity exceeds displayed stock shows the explicit need/available confirmation and remains writable only when the operator chooses `Vẫn tiếp tục lập phiếu?`.
- `MOD10-TC-UNIT-02` Passed (source/type): when a kg SKU has less than 1 kg available, a fresh outbound line defaults to grams. In the screenshot case, entering `5` against `5 g` converts to `0.005 kg`, while the operator can still deliberately change the selector to kg.
- `MOD10-TC-RESIDUE-01` Passed (source): positive bulk stock below the smallest configured packing source remains visible but reads `Còn dư, chưa đủ đóng gói`, never `Đủ bán`.
- `MOD10-TC-MENU-01` Passed (source/type/build): stock still contains every active configured SKU, but presentation separates priced non-kg POS sale items as `Món trong menu bán` and labels remaining finished bulk/process stock separately.
- `MOD10-TC-RPC-400-01` Passed for client-side known exceptions: an explicitly confirmed insufficient processing batch or sale-out bypasses the predictably rejected checked request instead of generating HTTP 400 first.
- `MOD10-TC-RPC-COUNT-02` Blocked — Requires direct schema approval: migration order can leave production with a checked-RPC body that ignores the latest physical count and advisory locking. No migration was created/applied.
- Evidence: `OWNER_UX_INVENTORY_ADMIN_20260720_OK`, core business guard and TypeScript pass in the correction batch. Broader inventory regression/build rerun is pending.

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
## 2026-07-18 cake processing-output linkage

- Fixture: input `cake-raw` must resolve active configured `cake-ready` even though its unit is `cái`, not `kg`.
- If the mapped system output is tombstoned, an active compatible warehouse-finished SKU such as `custom-tp-banh` must remain selectable; no historical movement is rewritten.
- Pre-fix: `scripts/test-processing-product-linkage.mjs` failed because Inventory filtered mapped IDs through kg-only `finishedBulkProducts`. Post-fix linkage/tombstone tests and TypeScript pass.
| MOD10-TC-SKU-01 | Open inventory at a branch with no movement for a company-wide active SKU | The SKU remains visible with stock 0; branch-specific quantity is not fabricated and outbound remains unavailable until positive stock exists | `PROCESSING_PRODUCT_LINKAGE_OK`, inventory/manager/tombstone/business regressions and TypeScript pass; production verification pending |
