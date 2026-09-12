# MOD-21 — Admin/employee messaging

Date: 2026-09-12. State: In progress (local implementation verified; production install/UI pending).

| Case | Expected | Evidence |
| --- | --- | --- |
| Employee contact directory | Only active Admins | Passed isolated PostgreSQL fixture |
| Admin contact directory | Active non-Admin employees across branches | Passed isolated PostgreSQL fixture |
| Employee → Admin | Persist authenticated sender/body | Passed DB and adapter |
| Admin → employee | Persist private reply | Passed DB and adapter |
| Employee → employee / broadcast | Reject | Passed DB and six-role adapter |
| Spoof sender / direct insert, update, delete | Reject client mutation | Passed authenticated DB grants test |
| Read someone else's chat | No rows | Passed DB: second employee and unrelated Admin |
| Inactive recipient | Reject | Passed DB |
| Admin broadcast | One private message per active employee | Passed DB; inactive excluded |
| Empty/overlength message | Reject before API and DB constraint | Passed adapter; DB migration constraint installed |
| Own read acknowledgement | Update recipient's unread rows only | Passed DB |
| History pagination | 50 rows, tied timestamps use UUID cursor | Passed DB: 58 rows, second page eight |
| LAN / missing migration | Visible unsupported/install error | Passed adapter |
| Menu/routes and controls | All current accounts can enter; sender rules enforced DB | Source discovered; four MessagesPage controls reachable in button contract |
| Desktop/mobile render, signed-in send/receive, realtime | Correct private conversation and responsive layout | Pending: in-app Browser unavailable in prior session attempt |

Commands: node scripts/test-messaging-adapter.mjs; scripts/test-messaging-postgres.ps1 (fresh localhost temporary cluster, stopped in finally); node scripts/test-ui-button-contract.mjs; npm.cmd run build.

Migration: supabase/migrations/20260912140000_admin_employee_messages.sql. Not applied to Supabase. No production business rows or existing business permissions modified.

## Header shortcut correction (2026-09-12)

- User requires non-Admin messaging entry beside bell rather than sidebar. Source/header contract passed; Admin menu preserved. Both headers render same compact shortcut, closes open menus and opens Messages.
- Adapter/payslip/nav/button regressions pass. Physical phone alignment and signed-in click pending; database behavior unchanged.

## Inbox preview/latest order (2026-09-12)

- Adapter/source checks passed: metadata endpoint, last-message preview, unread badge, refresh after send/read and via realtime/polling/visibility.
- Database checks added: conversation with newer message sorts ahead of alphabetical-first employee, preview is latest body, own incoming unread count clears on read, another employee's preview does not leak. Integration pending.
- Signed-in desktop/mobile visual/realtime verification pending; migration unapplied.
