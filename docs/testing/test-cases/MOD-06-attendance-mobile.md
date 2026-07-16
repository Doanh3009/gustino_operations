# MOD-06 — Attendance, mobile camera, GPS and clock

Status: in progress; direct iPhone verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD06-TC-SRC-01 | Decode iPhone attendance photo | EXIF orientation is honored and Safari fallback is available | `test-mobile-attendance-export.mjs` Passed |
| MOD06-TC-TIME-01 | Check in/out clock | Server timestamp is preferred; LAN server enforces its own timestamp | Static contract + TypeScript Passed |
| MOD06-TC-GPS-01 | Accurate branch geotag | Samples GPS, selects best fix and rejects accuracy worse than 150m | Static contract Passed; real GPS pending |
| MOD06-TC-GPS-03 | Fresh precise fix at check-in/out | Cached coordinates are forbidden; a coarse first fix triggers one additional fresh sample and the better coordinate is reverse-geocoded | `ATTENDANCE_NATIVE_CAMERA_LOCATION_OK` + TypeScript Passed; HTTPS phone pending |
| MOD06-TC-IDEMP-01 | Repeat/stale check-in | Existing attendance row is recovered and UI refreshes after error | Static contract Passed; integration pending |
| MOD06-TC-IOS-01 | iPhone 11 camera/GPS/permission | Check in and out without browser restart | Blocked pending physical device test |
| MOD06-TC-POPUP-01 | Today's attendance reminder | Capybara popup distinguishes check-in from check-out using current records | Static test Passed; UI pending |
| MOD06-TC-GPS-02 | Automatic location and concrete address | Check-in/out requests GPS without a separate permission panel; visible/stamped location is a reverse-geocoded address, never coordinate fallback | `test-attendance-native-camera-location.mjs` Passed; HTTPS iPhone pending |
| MOD06-TC-CAMERA-02 | Native phone capture | Attendance uses the phone-native capture input with no separate live camera/filter layer; iPhone decode fallback remains | `test-attendance-native-camera-location.mjs` Passed; physical iPhone pending |
