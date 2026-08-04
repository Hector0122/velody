## 1. Cache the readiness result

- [x] 1.1 Add a `cachedReady: boolean | null` field to `SetupManager`, initialized to `null`.
- [x] 1.2 In `isSetupComplete()`, return `cachedReady` immediately if it is `true`; otherwise run the full check as today.
- [x] 1.3 When the full check passes (all steps true), set `cachedReady = true` before returning. When it fails, leave `cachedReady` untouched (never cache `false`).
- [x] 1.4 At the top of `run()` (before the `simMode` early return), reset `cachedReady = null` so a re-run of setup (e.g. repair flow) re-verifies from scratch and picks up a fresh pass/fail.
- [x] 1.5 Confirm `canUseRealDemucs()` needs no changes (it already delegates to `isSetupComplete()` and will pick up the cache automatically).

## 2. Parallelize the underlying verification calls

- [x] 2.1 In `checkPython()`, replace the sequential `for` loop over `COMPATIBLE_PYTHON_VERSIONS` with a `Promise.all` that probes all candidates concurrently, then picks the first compatible match from the resolved results (preserve `COMPATIBLE_PYTHON_VERSIONS` order when multiple match, to keep existing precedence).
- [x] 2.2 In `checkDemucs()`, replace the sequential `for` loop over the package list with a `Promise.all` over `tryCmd(...)` calls for all packages, and `every()`/`.reduce` the results into the existing boolean return.
- [x] 2.3 Verify no other caller relies on `checkPython`/`checkDemucs` short-circuiting on first failure (e.g. for a specific error message) — behavior today is pass/fail only, so this should be a no-op check.

## 3. Tests

- [x] 3.1 Add/extend unit tests for `SetupManager` covering: first call runs verification and caches on success; second call reuses cache without spawning; a failing check is never cached and re-verifies on the next call; `run()` resets the cache.
- [x] 3.2 Add a test (or extend an existing one) asserting `checkPython`/`checkDemucs` issue their probes concurrently (e.g. via spy call-timing or by asserting all candidates are invoked before any result is awaited) rather than strictly sequentially.

## 4. Manual verification

- [ ] 4.1 Run `pnpm dev` with a real (or realistically mocked) Demucs venv set up, queue two separation jobs back to back, and confirm via logs/timing that the second job's readiness check does not re-spawn `pip show`/version-probe processes.
- [ ] 4.2 Run through first-run setup end to end once to confirm the setup screen still reports each step correctly with the parallelized checks.
