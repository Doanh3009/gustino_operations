# MOD-12 — Supply request completeness and status controls

Status: in progress; data-completeness regression passed, live role/UI verification pending.

## 2026-07-20 — Admin read-only list and Excel

- Admin Management purchasing reads filtered requests but no longer renders acknowledge/cancel mutations.
- Filtered rows export to `danh-sach-dat-hang-<from>-<to>.xlsx` with order/receive date, branch, requester, item, numeric quantity, unit, status and note.
- Operational Orders/Kitchen creation and status-transition handlers are unchanged.
- Evidence: `OWNER_UX_INVENTORY_ADMIN_20260720_OK`, `SUPPLY_REQUEST_DELIVERY_SCHEDULE_OK`, Admin ERP, UI-button, TypeScript and guarded build pass. Actual workbook-open verification remains pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD12-TC-DATA-01 | Authorized history exceeds 80 requests | Orders, Kitchen and management reporting receive every authorized request; date filtering cannot lose older rows because of a pre-filter cap | Pre-fix failed; `DATA_PAGINATION_CONSISTENCY_OK` and TypeScript/LAN syntax Passed after stable Supabase pagination and LAN cap removal |
| MOD12-TC-STATUS-01 | Kitchen processes a new request | Only the existing `pending → acknowledged → fulfilled` control mapping is used | `CORE_BUSINESS_BUTTON_GUARDS_OK`; no state transition changed |
| MOD12-TC-CANCEL-01 | Kitchen cancels/rejects a request | BA requires a reason, but current schema/source has no dedicated cancellation-reason contract | `Needs Business Confirmation`; no schema/status/API change authorized |
| MOD12-TC-IMAGE-01 | Leader exports the current order report | Export uses Blob/native Share Sheet or attached download fallback and gives a concise result; no detached data-URL click | `DEPLOY_UI_BUSINESS_POLISH_OK` + production build Passed; phone verification pending |
| MOD12-TC-DELIVERY-01 | Leader submits multiple order lines | One desired receiving date and period (morning/noon/afternoon) are stored on every line; order creation timestamp remains the authoritative order date | Pre-fix `SUPPLY_REQUEST_DELIVERY_SCHEDULE` contract failed; implementation active |
| MOD12-TC-STATUS-02 | Kitchen confirms and later sends an order | Existing `acknowledged` is displayed as Kitchen confirmed and `fulfilled` as Kitchen sent; leader realtime/history shows the same labels | Pre-fix contract failed; implementation active |
| MOD12-TC-MOBILE-01 | Open sent-order history at 320–720px with long Vietnamese product/note/status text | Compact rows use two content columns; status/actions occupy a full-width row and words wrap normally instead of falling vertically one character per line | `DASHBOARD_ORDERS_MOBILE_RECOVERY_OK`, supply schedule regression, TypeScript and build Passed; physical phone visual pending |
