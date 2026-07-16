# MOD-03 Branch and Cross-module Business Controls

Last updated: 2026-07-15

| Test | Rule | Evidence | Status |
|---|---|---|---|
| MOD03-TC-BRANCH-01 | A failed fallback branch upsert must expose its actual error to the Add branch/default-shift UI | Pre-fix failed; one-line fix throws `directError`; targeted and related regressions plus TypeScript pass | Passed — BUG-031 closed |
| UI-BIZ-LOGIN-01 | Inactive profile/inactive staff branch are rejected and login loading always releases | Same static guard | Passed |
| UI-BIZ-SALES-01 | Staff receipt delete is own + current day and asks for confirmation | Same static guard | Passed |
| UI-BIZ-ORDER-01 | Order submit requires positive finite quantity; cancel/delete ask for confirmation; cancel only appears while processing | Same static guard | Passed |
| UI-BIZ-KITCHEN-01 | Pending button advances to acknowledged; acknowledged button advances to fulfilled | Same static guard | Passed |
| UI-BIZ-INVENTORY-01 | Over-stock output warns; deleting a stock document asks for confirmation | Same static guard | Passed |
| UI-BIZ-ACCOUNT-01 | Account deletion is two-step and the current account cannot delete itself | Same static guard | Passed |
| UI-BIZ-CONTROL-01 | Destructive Control Center operations are confirmed and test-data purge rejects the current date | Same static guard | Passed |
| UI-BIZ-AUTOSAVE-01 | Payroll/default-pay/low-stock autosave failures must be visible instead of silently leaving local-only values | Pre-fix failed three assertions; error-banner fix plus UI/performance/KPI/TypeScript regressions pass | Passed — BUG-032 closed |

Live clicks, RLS results and multi-device effects remain blocked/pending separately; these are source-contract results.
