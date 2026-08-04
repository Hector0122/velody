## Why

Every separation job calls `JobManager.runJob()` → `SetupManager.canUseRealDemucs()` →
`isSetupComplete()`, which re-verifies Python and Demucs from scratch: it probes up to 3
Python versions sequentially via `execFile` (`checkPython`), then runs 6 sequential
`pip show <pkg>` subprocess spawns (`checkDemucs`, one per package: demucs, torch,
torchaudio, tempocnn, librosa, yt-dlp). None of this is cached — the exact same 9+
sequential subprocess spawns run again for every song a user separates in a session,
and again on every app startup to gate the setup screen. Each `pip show` invocation has
real process-startup and import overhead, so this adds seconds of pure overhead before
a separation job's actual work (Demucs) even begins, and is the single most frequently
repeated cost in the app since it fires on every job.

## What Changes

- Cache the result of `isSetupComplete()` / `canUseRealDemucs()` in `SetupManager` after
  the first successful check, so subsequent separation jobs in the same app session
  reuse the cached "ready" state instead of re-spawning 9+ processes.
- Invalidate the cache only when setup actually runs again (e.g. after `run()` completes,
  or when a job fails in a way that suggests the environment changed) — never serve a
  stale "ready" result if the environment could have changed underneath the app.
- Parallelize the still-necessary verification subprocess calls that remain
  (`checkPython`'s version probing, `checkDemucs`'s per-package `pip show` calls) with
  `Promise.all` instead of sequential `await` in a loop, so a cold/uncached check is
  bounded by the slowest single subprocess instead of the sum of all of them.

## Capabilities

### New Capabilities
- `demucs-readiness-check`: How the app determines and caches whether the real Demucs
  pipeline (vs. the simulation fallback) is available, covering both the setup screen
  and per-job gating in `JobManager`.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/main/setup/index.ts`: `SetupManager.isSetupComplete()`, `canUseRealDemucs()`,
  `checkPython()`, `checkDemucs()`.
- `src/main/jobs/JobManager.ts`: `runJob()` (caller of `canUseRealDemucs()`), indirectly
  affects separation job start latency.
- No IPC contract or renderer changes — purely an internal main-process optimization.
