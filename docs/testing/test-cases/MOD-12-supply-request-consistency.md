# MOD-12 — Supply request completeness and status controls

Status: in progress; data-completeness regression passed, live role/UI verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD12-TC-DATA-01 | Authorized history exceeds 80 requests | Orders, Kitchen and management reporting receive every authorized request; date filtering cannot lose older rows because of a pre-filter cap | Pre-fix failed; `DATA_PAGINATION_CONSISTENCY_OK` and TypeScript/LAN syntax Passed after stable Supabase pagination and LAN cap removal |
| MOD12-TC-STATUS-01 | Kitchen processes a new request | Only the existing `pending → acknowledged → fulfilled` control mapping is used | `CORE_BUSINESS_BUTTON_GUARDS_OK`; no state transition changed |
| MOD12-TC-CANCEL-01 | Kitchen cancels/rejects a request | BA requires a reason, but current schema/source has no dedicated cancellation-reason contract | `Needs Business Confirmation`; no schema/status/API change authorized |
| MOD12-TC-IMAGE-01 | Leader exports the current order report | Export uses Blob/native Share Sheet or attached download fallback and gives a concise result; no detached data-URL click | `DEPLOY_UI_BUSINESS_POLISH_OK` + production build Passed; phone verification pending |
