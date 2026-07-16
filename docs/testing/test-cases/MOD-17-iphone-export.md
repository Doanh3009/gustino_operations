# MOD-17 — iPhone infographic export

Status: in progress; direct iPhone verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD17-TC-SHARE-01 | Export on Web Share capable iPhone | Native Share Sheet receives a Blob-backed File | `test-mobile-attendance-export.mjs` Passed |
| MOD17-TC-FALLBACK-01 | Browser without file sharing | Attached object-URL download is used | Static test Passed |
| MOD17-TC-MSG-01 | Success guidance | App does not falsely claim the photo was saved; iPhone save action is explicit | Static test Passed |
| MOD17-TC-IOS-01 | Save to Photos/Files on iPhone 11 | Exported image is visible in the user-selected destination | Blocked pending physical device test |
| MOD17-TC-XLSX-01 | Export attendance workbook | Summary/detail sheets contain no Bữa sáng/Bữa trưa/Bữa tối columns; selected date range and evidence links remain | Corrected source regression Passed; real workbook verification pending |
| MOD17-TC-ORDER-01 | Export the order-request report on a phone | The rendered order sheet becomes a JPEG Blob, opens native Share Sheet when supported and otherwise downloads through the attached object-URL path | `DEPLOY_UI_BUSINESS_POLISH_OK` + build Passed; device verification pending |
