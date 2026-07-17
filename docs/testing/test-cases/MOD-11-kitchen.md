# MOD-11 — Kitchen production and order alerts

Status: in progress; kitchen order state controls pass static checks, idle bell defect fixed/deployed with physical-device verification pending.

| ID | Flow | Expected result | Automation/status |
|---|---|---|---|
| MOD11-TC-BELL-01 | Open Kitchen with zero pending requests, then perform the first pointer/key interaction | The ringtone must remain silent; audio may become available only without audible playback, and an audible ringtone may start only for a newly detected pending request | Passed source/build/live-bundle verification: `KITCHEN_IDLE_BELL_OK`; the prime path sets `muted` before `play`, pauses/resets before restoring state, and does not call the real alert helper. New-pending and guarded 60-second reminder assertions remain intact. Production `dpl_CgasdGCNoQyu2nSq6sQeUu2yKDZY` serves the corrected chunk; audible verification on the reporting device remains pending. |
