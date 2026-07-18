# MOD-06 — Attendance, mobile camera, GPS and clock

Status: in progress; direct iPhone verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD06-TC-SRC-01 | Decode iPhone attendance photo | EXIF orientation is honored and Safari fallback is available | `test-mobile-attendance-export.mjs` Passed |
| MOD06-TC-TIME-01 | Check in/out clock | Server timestamp is preferred; LAN server enforces its own timestamp | Static contract + TypeScript Passed |
| MOD06-TC-TIME-02 | Display a completed 13:55–22:20 shift and search the employee by name | Elapsed time remains 505 minutes/8.42 decimal hours for payroll, but UI shows `8 giờ 25 phút`; employee search accepts accented or unaccented text and narrows the correction list | Passed source/build/live-asset verification; production Admin/Attendance/CSS return 200 with duration/search contracts. Signed-in visual verification pending because Browser session is unavailable. |
| MOD06-TC-DELETE-01 | Admin deletes one erroneous attendance record from the employee/day row | Confirmation names the employee and date, requires a reason, deletes only the selected attendance record, writes an audit before-state and refreshes attendance/payroll | Passed local contract, production catalog and live frontend asset verification. No real attendance record was deleted during testing; one deliberate owner action remains pending. |
| MOD06-TC-GPS-01 | Accurate branch geotag | Samples GPS, selects best fix and rejects accuracy worse than 150m | Static contract Passed; real GPS pending |
| MOD06-TC-GPS-03 | Fresh precise fix at check-in/out | Cached coordinates are forbidden; a coarse first fix triggers one additional fresh sample and the better coordinate is reverse-geocoded | `ATTENDANCE_NATIVE_CAMERA_LOCATION_OK` + TypeScript Passed; HTTPS phone pending |
| MOD06-TC-IDEMP-01 | Repeat/stale check-in | Existing attendance row is recovered and UI refreshes after error | Static contract Passed; integration pending |
| MOD06-TC-SYNC-01 | Change the main shift after an attendance row exists for that employee/day | Update the attended registration in place, preserve its attendance evidence, remove only unattached duplicate main rows, block OFF after check-in and refuse ambiguous multi-attended days | `SCHEDULE_ATTENDANCE_REGISTRATION_SYNC_OK`; production RPC installed and Phạm Đình Phát repair verified |
| MOD06-TC-IOS-01 | iPhone 11 camera/GPS/permission | Check in and out without browser restart | Blocked pending physical device test |
| MOD06-TC-POPUP-01 | Today's attendance reminder | Capybara popup distinguishes check-in from check-out using current records | Static test Passed; UI pending |
| MOD06-TC-GPS-02 | Automatic location and concrete address | Check-in/out requests GPS without a separate permission panel; visible/stamped location is a reverse-geocoded address, never coordinate fallback | `test-attendance-native-camera-location.mjs` Passed; HTTPS iPhone pending |
| MOD06-TC-CAMERA-02 | Native phone capture | Attendance uses the phone-native capture input with no separate live camera/filter layer; iPhone decode fallback remains | `test-attendance-native-camera-location.mjs` Passed; physical iPhone pending |
## 2026-07-18 idempotent write/read-back

- Check-in retry must reuse the same record ID and recover the existing row through the unique registration constraint.
- Check-out must select/read back the affected row; zero updated rows cannot be reported as success unless the authoritative row is already checked out.
- Selfie upload retries once with the same path; LAN repeated checkout returns the already-saved row.
- Pre-fix: `scripts/test-attendance-idempotent-write.mjs` failed. Post-fix it reports `ATTENDANCE_IDEMPOTENT_WRITE_OK`; native/mobile regressions and TypeScript pass. Production read-only audit has zero duplicate registration rows/zero completed evidence gaps and 9 open rows older than 18 hours; no historical row was edited.
