# Cross-module UI Button Contract

Last updated: 2026-07-15

## Scope

- All native `<button>` elements under `src/**/*.tsx`.
- Static action wiring, form semantics, permanently disabled/no-op handlers and TypeScript-resolvable handlers.
- Business-critical behavior is cross-checked by the module-specific tests; this file does not replace live browser/device execution.

## Results

| Test | Expected | Evidence | Status |
|---|---|---|---|
| UI-BTN-01 inventory | Every native button is enumerated with file, source line and import-graph reachability | `node scripts/test-ui-button-contract.mjs` found 195 buttons in 20 files: 189 reachable from `App.tsx`, six in unimported legacy pages | Passed |
| UI-BTN-02 action wiring | Button has `onClick`, or submits a form with `onSubmit` | Same command; no `no-action` or `submit-form-without-handler` result | Passed |
| UI-BTN-03 form semantics | No submit outside a form and no click button that implicitly also submits | Same command; no `submit-outside-form` or `implicit-submit-with-click` result | Passed |
| UI-BTN-04 dead controls | No empty/null click handler or statically permanent `disabled=true` | Same command; no `noop-click` or `always-disabled` result | Passed |
| UI-BTN-05 handler type safety | Referenced handlers and props resolve under application TypeScript | `npx.cmd tsc -p tsconfig.app.json --noEmit --incremental false` | Passed |
| UI-BTN-06 real interaction | Click every visible control for each permitted role, viewport and business state | Required in-app Browser discovery returned `[]`; Playwright is not substituted under the Browser workflow | Blocked |

## File inventory

`AppShell` 15; `AttendanceAdjustmentArchive` 4; `ShiftPhotoButton` 3; Admin 21; Attendance 21; Control Center 23; History 2; Home 4; Inventory 28; Kitchen 2; Launcher 7; Login 1; Manager Dashboard 13; My Records 5; Orders 10; Report Archive 4; Report 5; Sales 12; Shift Handover 3; Today 12.

`HomePage.tsx` (four buttons) and `HistoryPage.tsx` (two buttons) are not reachable from the current `App.tsx` import graph. They are legacy source, not visible controls. The active UI count is therefore 189.

## Evidence boundary

Passing the static contract proves that controls are wired and compilable. It does not prove visual hit targets, browser APIs, realtime multi-device transitions, external Zalo/n8n delivery, or production RLS behavior. Those cases stay pending/blocked until a controllable browser/device and safe test environment are available.
