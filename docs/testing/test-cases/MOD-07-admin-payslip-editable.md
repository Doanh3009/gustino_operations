# MOD-07 — Admin editable payslip (2026-10-09)

| Case | Expected | Evidence |
|---|---|---|
| Open a payslip with configured salary values | Values are prefilled and labelled as system-derived; Admin can edit them | `ADMIN_PAYSLIP_EDITABLE_OK` |
| Open a payslip with attendance overtime or KPI reward | Values are prefilled and remain editable by Admin | `ADMIN_PAYSLIP_EDITABLE_OK` |
| Save edited overtime and KPI | Save payload uses the displayed Admin values | `ADMIN_PAYSLIP_EDITABLE_OK` |
| Existing publish/revoke/employee delivery flows | Existing access and lifecycle contracts still pass | Admin, delivery, revoke/delete, confirmation and viewed scripts passed |

Signed-in visual and database save/reopen verification remain pending. No production data was changed during this batch.
