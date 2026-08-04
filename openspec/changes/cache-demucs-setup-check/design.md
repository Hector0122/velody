## Context

See proposal.md - Why. `SetupManager` (`src/main/setup/index.ts`) is a per-process
singleton constructed once in `src/main/index.ts` and shared by `JobManager` and the
IPC handlers. `isSetupComplete()` is the single choke point both the setup screen and
`JobManager.runJob()` (via `canUseRealDemucs()`) go through; there is currently no
memoization anywhere in that path.

## Goals / Non-Goals

**Goals:**
- Eliminate redundant subprocess spawns for readiness checks that already succeeded
  once in the current app session.
- Keep the check safe: never report "ready" when the environment is not actually ready.
- Reduce worst-case latency of a genuinely cold check via concurrency.

**Non-Goals:**
- Cross-process/persistent caching (e.g. writing the result to disk) — the cache only
  needs to live for the app process lifetime; a fresh app launch re-verifies once.
- Filesystem watching to detect the user manually breaking their venv mid-session —
  out of scope; the existing failure path (job fails, error surfaced) already handles
  environment breakage, it just won't retroactively un-cache mid-session.
- Changing the simulation-mode fallback behavior (`simMode` short-circuit is untouched).

## Decisions

- **In-memory boolean cache on `SetupManager`, not a TTL cache.** The dependency set
  (Python/venv/Demucs/FFmpeg) only changes via first-run setup or manual user action
  outside the app; it doesn't need periodic re-validation within a session. A simple
  `private cachedReady: boolean | null = null` set only on a fully-passing check keeps
  the change small and matches the "don't cache negatives" requirement naturally (only
  write `true`, never write `false`).
- **Invalidate on `run()` entry, not on a timer.** `run()` is the only path that changes
  the underlying environment (installs venv/Demucs/FFmpeg), so clearing
  `cachedReady = null` at the top of `run()` (before `simMode`'s early return) is
  sufficient to guarantee a post-setup readiness query re-verifies rather than reusing
  a stale pre-setup negative — though negatives are never cached anyway, this also
  covers the case where `run()` is invoked again after an already-successful setup
  (e.g. "repair install" flows), so the freshly (re-)installed state is picked up.
- **`Promise.all` for `checkPython`'s version probe and `checkDemucs`'s per-package
  checks**, replacing the sequential `for...of` + `await` loops. Considered keeping
  them sequential with early-exit-on-first-match for `checkPython` (marginally less
  process spawning in the common case where the first candidate matches) — rejected
  because the current code already checks all candidates in the worst case (no match
  found on PATH), and concurrency bounds *that* worst case, which is the case that
  actually hurts (falls through to a Python download). `checkDemucs` has no early-exit
  semantics today (it already checks all 6 packages for a clean pass/fail signal), so
  concurrency is a strict win there with no behavior change.

## Risks / Trade-offs

- [Caching could mask a Demucs package silently uninstalled mid-session by something
  outside the app] → Low likelihood (nothing else touches this venv in normal use);
  accepted, since the existing job-failure path already surfaces the resulting error
  if a job then fails, and the user can restart the app to force re-verification.
- [`Promise.all` changes stderr/stdout interleaving order in logs, if any of these
  checks log] → None of the affected checks (`execFile`-based version probes,
  `pip show`) currently log anything on the happy path; only the final pass/fail
  boolean is observed, so no observable behavior changes.

## Migration Plan

No data migration. Roll out as a normal code change to `SetupManager`; no IPC or
renderer changes, so no coordination needed with the renderer build. Rollback is a
plain revert if an issue surfaces.
