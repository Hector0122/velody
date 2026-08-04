## Purpose

Defines how the app determines and reuses whether the real Demucs pipeline is
available, so that separation jobs and the setup screen do not repeatedly pay
the cost of re-verifying the Python/Demucs environment from scratch.

## ADDED Requirements

### Requirement: Readiness result is cached after a successful check
Once the system has determined that Python, the venv, Demucs and its
dependencies, and FFmpeg are all present and compatible, it SHALL reuse that
"ready" result for subsequent readiness queries within the same app session
instead of re-running the underlying verification commands.

#### Scenario: Second separation job in the same session
- **WHEN** a user starts a second separation job after a first job already
  completed a successful readiness check in the current session
- **THEN** the system SHALL NOT re-run the Python/Demucs/FFmpeg verification
  commands and SHALL immediately treat the job as ready to use real Demucs

#### Scenario: App startup after a completed first-run setup
- **WHEN** the app starts and the readiness check has already succeeded once
  during the current process lifetime
- **THEN** subsequent readiness queries (e.g. gating the setup screen) SHALL
  use the cached result rather than re-spawning verification subprocesses

### Requirement: Cache is not used to mask a real setup failure
The cached "ready" result SHALL only ever be a positive (fully ready) result.
A negative or partial readiness result SHALL NOT be cached, so a transient or
fixable failure is re-checked on the next query rather than being "stuck".

#### Scenario: Readiness check fails
- **WHEN** the readiness check determines that Demucs is not fully installed
- **THEN** the system SHALL NOT cache that negative result, and the next
  readiness query SHALL re-run the full verification

#### Scenario: Setup completes after a prior failure
- **WHEN** the user runs first-run setup successfully after a previous
  failed or incomplete readiness check
- **THEN** the next readiness query SHALL reflect the new "ready" state
  (the stale negative state SHALL NOT persist)

### Requirement: Verification subprocess calls run concurrently
When a readiness check must actually run (no valid cached result exists),
the independent verification steps it performs (checking each required
Python version candidate, checking each required Demucs dependency package)
SHALL run concurrently rather than one at a time, so total wall-clock time
for an uncached check is bounded by the slowest single verification step
rather than the sum of all steps.

#### Scenario: Cold readiness check with all dependencies present
- **WHEN** the system performs a readiness check with no cached result and
  all required Python versions/packages are already installed
- **THEN** the individual verification commands for those dependencies SHALL
  be issued concurrently, not sequentially
