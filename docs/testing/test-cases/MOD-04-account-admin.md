# MOD-04 — Employee/account administration

Status: in progress; production Edge deployment and exact affected-username verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD04-TC-SYNC-01 | Load account administration with an inactive profile that still has a login email | The account remains visible as `Đã xóa`, while operational employee reports continue to exclude it | `ACCOUNT_ORPHAN_RECOVERY_OK` + TypeScript Passed |
| MOD04-TC-SYNC-02 | Permanent Auth deletion fails | The profile is not removed after the Auth failure, so the occupied username does not disappear from account administration | `ACCOUNT_ORPHAN_RECOVERY_OK` Passed; Edge deploy pending |
| MOD04-TC-SYNC-03 | Create an exact-email username whose Auth user exists but profile is missing | Recover only after proving the profile is absent; otherwise report the existing account name/status | `ACCOUNT_ORPHAN_RECOVERY_OK` Passed; production audit currently has zero true orphans |
| MOD04-TC-DELETE-02 | Hard-delete an inactive test account | Inactive account remains visible with username-retention warning; Admin can invoke hard-delete, Auth is removed before profile, and signed-in account remains protected | `ACCOUNT_ORPHAN_RECOVERY_OK`; production has four legacy inactive Auth/profile pairs, no automatic deletion performed |

Production read-only audit on 2026-07-18 found 37 Auth users and 37 profiles, with zero missing rows in either direction. No account was deleted, recreated or reset during the audit.
