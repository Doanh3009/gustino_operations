# MOD-06 — Attendance, mobile camera, GPS and clock

Status: in progress; direct iPhone verification pending.

## 2026-08-03 — Admin correction filter context

- `MOD06-TC-FILTER-CONTEXT-01` Reproduced: clicking `Chỉnh công` in a day-filtered row unconditionally switches to employee mode and clears search context. Pre-fix `test-admin-attendance-filter-context.mjs` exits 1 and prints the forced mode change.
- Expected/Passed: editing a visible row opens inline without changing mode, day, local branch, employee or search. A correction opened from the separate auto-close error table reveals its exact day/branch. Branch has its own selector in both modes; moving month retains employee/search; “Xem các ca của nhân viên” is an explicit opt-in action.
- Evidence: six focused attendance/Admin/UI regressions, TypeScript, 253-button/247-reachable contract, diff check and 723-module production build/bundle guard Passed. Production `dpl_CuLBRp2irftLEya4r2c8jt6Rgj1v` is READY/aliased with live markers; exact pre/post SELECT-only counts show no data decrease. Browser discovery returned `[]`, so signed-in visual QA remains. No attendance RPC/record/payroll/audit/permission changed.

## 2026-08-03 — mistaken supplement deletion

- `MOD06-TC-SUPPLEMENT-DELETE-01` Reproduced: deleting only the attendance record leaves an exact system-created supplement registration, which renders as absent/no record. Existing delete migration intentionally preserves registrations.
- Expected: one delete removes record + registration only when the registration is marker-owned Admin supplement; an already orphaned supplement has a separate audited cleanup action; all normal registrations remain untouched. Pre-fix delete regression is red. Production migration requires explicit approval.
- Attendance future-date subcase Passed locally; no deploy yet. Conditional delete remains blocked before migration creation pending direct owner approval.

## 2026-08-03 — older-month Admin correction navigation

- `MOD06-TC-HISTORY-MONTH-01` Reproduced: correction `type=date` is constrained to the current global range and its panel has no month selector. Pre-fix `ADMIN_ATTENDANCE_HISTORY_MONTH` exits 1 at the missing month input.
- Expected: Admin can choose any past month directly beside the correction list, move previous/next one month, load exactly that month's attendance and retain audited correction behavior. Future months remain disabled.
- Post-fix automation Passed: `ADMIN_ATTENDANCE_HISTORY_MONTH_OK`, Admin 24h/report/resilience/error-list checks, 252-button contract and TypeScript. Production build/live verification remain.
- `MOD06-TC-SUPPLEMENT-TIME-ROW-01` Reproduced from owner screenshot: `Giờ vào` and `Giờ ra` occupy different desktop rows. Extended 24h regression fails before the layout fix; expected is a two-column paired-time group on desktop and a one-column stack only on phone.
- `MOD06-TC-SUPPLEMENT-TIME-ROW-01` Passed after implementation together with historical-month, button and TypeScript checks. The same Time24 controls/RPC payload are retained; only responsive grouping changed.
- Production verification Passed on deployment `dpl_5ey5DqMEitLPwswkMFzqL2rKUSHg`: live Admin/Archive/CSS expose both month navigation and paired-time rules. Signed-in visual confirmation remains with the owner; Browser discovery is unavailable.

## 2026-08-03 — automatic stale close, Admin correction UX and request notes

- `MOD06-TC-AUTOCLOSE-01` Passed: an open prior-day shift closes only after its registered Vietnam-time scheduled end; overnight shifts wait for the real end, current-day rows remain open, PATCH is guarded by `check_out_time=is.null`, and cloud pagination covers more than 200 employees. Eligible rows run at bounded concurrency 12; a deliberately failed row is counted/isolated while later rows still close. LAN reconciles the same stale state before attendance reads/new Check-in.
- `MOD06-TC-EMPLOYEE-NOBU-01` Passed: Employee Attendance has no `Check-out bù`, no self-declared `missing_checkout` option and no legacy action call. The overdue card is read-only and explains automatic close plus Admin review; LAN rejects the retired request.
- `MOD06-TC-ADMIN-ERROR-01` Passed: each system-closed forgotten checkout has a machine marker, appears in the Admin unresolved-error list and deep-links to the existing audited correction form. Correcting it replaces the marker, so it leaves the unresolved list without a schema/status change.
- `MOD06-TC-ADMIN-24H-01` Passed: correction and supplement entry use explicit 00–23/00–59 controls independent of desktop AM/PM; correction can fill registered shift times in one click and supplement entry supports accent-insensitive employee/branch search.
- `MOD06-TC-REQUEST-NOTE-01` Passed: early-leave/late-arrival requests are paginated and joined by exact employee ID + branch ID + work date. Admin table and attendance Excel Notes show request type, requester, Vietnam submission datetime, scheduled→requested time, reason and evidence note.
- Evidence: focused integration Passed, the broader attendance/load batch is 22/22 green, and the final 723-module production build/bundle guard Passed. Deployment `dpl_2FJLJyP4RqkmpxEzGv2vXHchkv6S` is READY/aliased; live Admin/Attendance/AdjustmentArchive markers and protected API behavior are verified. No production row or schema was touched.

## 2026-08-03 — next-day state and many-employee realtime

- `MOD06-TC-NEXTDAY-01` Reproduced pre-fix: at 00:30 Vietnam time a UTC device computes the prior date in `AttendancePage`; the page also renders Check-in without considering another own-open record or a pending check-in outbox op.
- `MOD06-TC-REMINDER-RACE-01` Reproduced pre-fix: overlapping AppShell reminder reads have no request version/deadline; an older response can restore Check-in after a newer post-write read.
- `MOD06-TC-REALTIME-SCOPE-01` Reproduced pre-fix: every client subscribes to all registration/attendance events and each event starts a full refresh. Expected: user/authorized-branch filter, burst coalescing, cleanup and fallback reconciliation.
- `MOD06-TC-OUTBOX-STATE-01` Reproduced pre-fix: pending check-in is only a note/banner and does not suppress a second Check-in action. Expected: pending evidence is an authoritative in-progress state until server confirmation or an explicit persistence error.
- Evidence: `scripts/test-attendance-realtime-next-day.mjs` fails before implementation with `ATTENDANCE_REALTIME_NEXT_DAY_FAIL`. Multi-context Browser QA remains blocked because discovery returned `[]`.
- Post-fix focused status: all four cases above Passed via `ATTENDANCE_REALTIME_NEXT_DAY_OK`; outbox and single-open regressions also Passed. Broader regression and final build Passed; physical/multi-context QA remains pending.
- Hardening assertions now also cover: non-authoritative IndexedDB reads fail closed, RAM durability is explicit, evidence never expires before server confirmation, single-open `23505` requires exact-registration read-back, and conflict evidence is retained without automatic stale replay. Passed after implementation.
- `MOD06-TC-LAN-REPLAY-01` Passed: an explicitly marked offline replay retains the valid original check-in/check-out timestamp on the registered UTC+7 date, including outside nominal shift hours as the current UI permits; ordinary LAN requests remain server-timestamped, a future replay timestamp is rejected, and permanent rejection evidence becomes `needs-review` (`LAN_ATTENDANCE_API_INTEGRATION_OK`, next-day contract).
- Final regression status after the LAN replay correction: 15/15 focused MOD-06-related commands plus LAN integration, performance/sync, pagination and shift realtime reminder checks Passed (19/19 total pre-build commands).
- Final build status: Passed after all source/test changes, 719 modules with bundle guard green; attendance asset `AttendancePage-Cs_zPtp1.js`. No deploy or production mutation followed.
- Final-review pre-fix reproduction added: transaction abort after IDB request success, orphaned checkout evidence, permanent-op queue blocking, LAN forged identity/path, and unbounded Board-week read/subscription assertions all fail before the hardening patch. Status: Reproduced; implementation/verification in progress.
- Post-hardening status: the new IDB abort behavior test, next-day/integrity/load contract, isolated LAN integration and TypeScript all Passed. Orphaned/permanent evidence is retained `needs-review`; Board data is bounded to the viewed week.
- Full post-hardening regression: 19/19 attendance/load commands Passed. Final build also Passed with 719 modules/bundle guard, attendance asset `AttendancePage-Cs_zPtp1.js`.
- Final scoped diff/syntax/source-pattern review Passed. Local automation is complete; physical multi-device/HTTPS camera-GPS and production catalog verification remain pending.

## 2026-07-20 — intermittent saved-write confirmation

- `MOD06-TC-SAVED-UI-01` Passed (source/type/build): a successful check-in record is merged into the visible schedule immediately; a refresh failure cannot restore the stale Check-in action or overwrite final success feedback.
- `MOD06-TC-SAVED-UI-02` Passed (source/type/build): LAN/cloud check-out returns a completed record and the visible schedule moves to completed before realtime reconciliation.
- `MOD06-TC-GEOCODE-RETRY-01` Passed (real-handler mock + source): local reverse geocoding retries twice; the server races Nominatim and BigDataCloud rather than spending up to 10 seconds sequentially, and the 6.5-second client bound exceeds each provider's 5-second timeout. Coordinates are never accepted as a fake address.
- `MOD06-TC-GEOCODE-QUALITY-01` Passed (real-handler mock + LAN/source): both providers still start concurrently; when the fast fallback returns only city/province, the handler gives the street/ward source an 800 ms grace period, then falls back without restoring the old sequential delay.
- Existing rules preserved: native camera file capture, stamped image, fresh high-accuracy GPS, maximum 150m accuracy, concrete address, own approved registration, bounded idempotent write retry and read-back.
- Evidence: `ADMIN_CLEANUP_ATTENDANCE_RESILIENCE_OK`, `ATTENDANCE_REVERSE_GEOCODE_RACE_OK` and TypeScript pass in the correction batch; earlier idempotency/native-location/cloud/build evidence remains. Physical device check remains pending because Browser is unavailable.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD06-TC-SRC-01 | Decode iPhone attendance photo | EXIF orientation is honored and Safari fallback is available | `test-mobile-attendance-export.mjs` Passed |
| MOD06-TC-TIME-01 | Check in/out clock | Server timestamp is preferred; LAN server enforces its own timestamp | Static contract + TypeScript Passed |
| MOD06-TC-TIME-02 | Display a completed 13:55–22:20 shift and search the employee by name | Elapsed time remains 505 minutes/8.42 decimal hours for payroll, but UI shows `8 giờ 25 phút`; employee search accepts accented or unaccented text and narrows the correction list | Passed source/build/live-asset verification; production Admin/Attendance/CSS return 200 with duration/search contracts. Signed-in visual verification pending because Browser session is unavailable. |
| MOD06-TC-DELETE-01 | Admin deletes one erroneous attendance record from the employee/day row | Confirmation names the employee and date, requires a reason, deletes only the selected attendance record, writes an audit before-state and refreshes attendance/payroll | Passed local contract, production catalog and live frontend asset verification. No real attendance record was deleted during testing; one deliberate owner action remains pending. |
| MOD06-TC-GPS-01 | Accurate branch geotag | Samples GPS, selects best fix and rejects accuracy worse than 150m | Static contract Passed; real GPS pending |
| MOD06-TC-GPS-03 | Fresh precise fix at check-in/out | Cached coordinates are forbidden; a coarse first fix triggers one additional fresh sample and the better coordinate is reverse-geocoded | `ATTENDANCE_NATIVE_CAMERA_LOCATION_OK` + TypeScript Passed; HTTPS phone pending |
| MOD06-TC-IDEMP-01 | Repeat/stale check-in | Existing attendance row is recovered and UI refreshes after error | Static contract Passed; integration pending |
| MOD06-TC-REGISTER-01 | Employee opens Today without a same-day registration | Explain that no shift is registered and provide a direct action to the existing weekly registration board; do not fabricate a shift or attendance record | `DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK`; live Attendance asset marker verified |
| MOD06-TC-SYNC-01 | Change the main shift after an attendance row exists for that employee/day | Update the attended registration in place, preserve its attendance evidence, remove only unattached duplicate main rows, block OFF after check-in and refuse ambiguous multi-attended days | `SCHEDULE_ATTENDANCE_REGISTRATION_SYNC_OK`; production RPC installed and Phạm Đình Phát repair verified |
| MOD06-TC-IOS-01 | iPhone 11 camera/GPS/permission | Check in and out without browser restart | Blocked pending physical device test |
| MOD06-TC-POPUP-01 | Today's attendance reminder | Capybara popup distinguishes check-in from check-out using current records | Static test Passed; UI pending |
| MOD06-TC-GPS-02 | Automatic location and concrete address | Check-in/out requests GPS without a separate permission panel; visible/stamped location is a reverse-geocoded address, never coordinate fallback | `test-attendance-native-camera-location.mjs` Passed; HTTPS iPhone pending |
| MOD06-TC-GPS-04 | Fast administrative address and slightly slower street-level address both succeed | Prefer the street/ward address within a bounded 800 ms grace; if that source fails, use the already-running administrative fallback | `ATTENDANCE_REVERSE_GEOCODE_RACE_OK`, `ATTENDANCE_INTERMITTENT_RECOVERY_OK`, LAN syntax and build Passed; physical HTTPS GPS/address pending |
| MOD06-TC-CAMERA-02 | Native phone capture | Attendance uses the phone-native capture input with no separate live camera/filter layer; iPhone decode fallback remains | `test-attendance-native-camera-location.mjs` Passed; physical iPhone pending |
## 2026-07-18 idempotent write/read-back

- Check-in retry must reuse the same record ID and recover the existing row through the unique registration constraint.
- Check-out must select/read back the affected row; zero updated rows cannot be reported as success unless the authoritative row is already checked out.
- Selfie upload retries once with the same path; LAN repeated checkout returns the already-saved row.
- Pre-fix: `scripts/test-attendance-idempotent-write.mjs` failed. Post-fix it reports `ATTENDANCE_IDEMPOTENT_WRITE_OK`; native/mobile regressions and TypeScript pass. Production read-only audit has zero duplicate registration rows/zero completed evidence gaps and 9 open rows older than 18 hours; no historical row was edited.
