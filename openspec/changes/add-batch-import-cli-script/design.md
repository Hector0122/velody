## Context

See proposal.md — Why. Relevant existing pieces, established by direct code reading
(not assumption):

- `python-worker/download.py`: `python download.py <url> [--ffmpeg-path <path>]`,
  emits JSON lines (`metadata`/`progress`/`complete`/`error`), downloads to a fresh
  OS temp dir via `tempfile.mkdtemp`, and its `complete.path` is a file inside that
  ephemeral temp dir named from the video title with no custom sanitization. Nothing
  cleans that temp dir up.
- `python-worker/separate.py`: `python separate.py <audio-file> [--job-id <uuid>]
  [--output-dir <dir>]`, emits JSON lines, runs Demucs (`htdemucs_6s`, 6 stems:
  vocals/drums/bass/other/piano/guitar), and writes to
  `<output-dir or default>/<audio_file.stem>/<stem>.mp3` — the song folder name is
  the input file's bare filename stem, again with **no sanitization** anywhere in the
  pipeline.
- `src/main/setup/index.ts` (`SetupManager`) has no Electron dependency itself; its
  Python/FFmpeg path resolution is pure, computable logic:
  `homedir()/.local/share/velody/venv/{Scripts|bin}/python{.exe|3}` (falling back to
  bare `python`/`python3` on PATH), and
  `homedir()/.local/share/velody/ffmpeg/bin/ffmpeg{.exe|}` (falling back to bare
  `ffmpeg`). Nothing persists these as a state file — they're recomputed via
  `existsSync` each call, so a standalone script can replicate the same computation
  without any IPC or Electron runtime.
- `src/main/jobs/JobManager.ts` and `src/main/ipc/handlers.ts` (`url:import`) both
  import `{ app, BrowserWindow }` from `electron` at module scope and touch them on
  every call path (`app.isPackaged`, `app.getPath('userData')`,
  `BrowserWindow.getAllWindows()`). Requiring `electron` from plain `node` resolves to
  a string, not the API object, so importing either file as-is from a headless script
  throws immediately (`Cannot read properties of undefined`). They are not
  reusable as library imports without stubbing Electron.
- Song library scanning (`scanSongsLibrary` in `handlers.ts`) only requires: a
  subdirectory of `output/stems/` containing at least one file whose name starts with
  `vocals`/`drums`/`bass`/`other`/`piano`/`guitar`. No `.velody` sidecar is required
  for a song to appear; that file is only written lazily by the renderer's BPM-cache
  flow (`useSongAnalysis.ts`) the first time a song is opened.
- The user's real input file (`links.txt`) is tab-separated,
  `#\tTitle\tArtist\tURL[\tstatus]`, pasted from a spreadsheet, with a header row and
  a trailing blank row, and already has two rows manually marked done (`Listo`, `1`)
  in a 5th column — i.e. there's an existing ad hoc "done" convention worth
  formalizing rather than replacing.

## Goals / Non-Goals

**Goals:**
- Let the user run one command against their existing `links.txt` and walk away; a
  105-song run will take hours (each song is a full download + Demucs separation,
  each individually capped at 10 minutes), so it must be safe to interrupt and resume
  without re-downloading/re-separating already-completed songs or losing track of
  which ones failed.
- Match the app's existing on-disk conventions exactly (`output/stems/<song>/<stem>.mp3`)
  so songs the script produces are indistinguishable, from the app's point of view,
  from ones imported through the UI.
- Keep the implementation small and dependency-free: no new npm packages, no new
  Electron surface, no changes to files the app's main process depends on.

**Non-Goals:**
- Parallel/concurrent downloads or separations. `JobManager` is strictly one-at-a-time
  today specifically because Demucs (PyTorch) and TempoCNN are heavy; a batch script
  introducing concurrency here would be a new resource-contention risk this proposal
  has no reason to take on. Sequential, matching existing behavior, is correct for v1.
- Running BPM/key detection as part of the batch. `detect_bpm.py` is TensorFlow-backed
  and the app already guards it with a singleflight specifically because concurrent
  TempoCNN processes OOM low-RAM Windows machines (see CLAUDE.md). Firing it 105 times
  in an unattended loop, outside that guard, is a real risk for no benefit — the app
  already does this lazily and cheaply (once) the first time each song is opened.
- A GUI/in-app "batch import" feature. Explicitly out of scope per the user's own
  choice of a standalone CLI script; revisit separately if wanted later.
- General-purpose queue/import tooling for arbitrary future formats. This script is
  scoped to "a links file in, stems on disk out" for this and future batches, not a
  pluggable import framework.

## Decisions

- **Re-implement the small amount of needed logic directly in the script rather than
  importing `SetupManager`/`JobManager`.** Both are Electron-coupled at module scope
  (see Context) and stubbing Electron just to import them is more fragile than
  duplicating ~30 lines of pure path arithmetic and ~60 lines of "spawn a Python
  script, parse its JSON-lines stdout" logic that's already been read line-by-line
  for this proposal. Trade-off: if `SetupManager`'s venv/FFmpeg path scheme changes,
  this script needs a matching update — acceptable and called out as a known
  duplication, not hidden.
- **Plain `.mjs`, run via `node`, no `ts-node`/`tsx` dependency.** The repo has no
  existing convention for standalone Node scripts and no TS-script runner installed.
  Adding one just for this script is more new surface than the script itself
  justifies; plain ESM (Node supports `.mjs` regardless of `package.json`'s `"type"`)
  needs nothing new.
- **Resumability via two independent checks, not just one:**
  1. A status column written back into the links file itself (`OK` / `ERROR: <msg>`),
     because the user already had their own informal "done" markers there and a
     spreadsheet-shaped audit trail (what happened to each row) is genuinely useful
     for 105 songs run unattended.
  2. A filesystem check (does `output/stems/<sanitized-name>/` already contain stem
     files?) as a second, independent guard — so even a hand-edited or regenerated
     links file, or a folder populated some other way, is still respected and not
     redundantly reprocessed.
  A row is treated as **pending** (will be processed) unless its status column is
  non-empty and does not start with `ERROR` (case-insensitive) — so a fresh `ERROR`
  row is retried automatically on the next run, while any other non-empty marker
  (including the user's pre-existing `Listo`/`1`) is treated as done. This makes
  "just run it again" the entire resume story, with no separate resume flag.
- **Sanitize the output folder name, unlike either `download.py` or `separate.py`.**
  Neither strips filesystem-unsafe characters today; that's tolerable for one-off UI
  imports (where yt-dlp's own title-derived sanitization is usually enough) but for
  an unattended 105-song run on Windows, a stray character from a video title
  reaching `Path.mkdir` is a failure mode worth closing off. The script derives the
  folder name from the links file's own `Title`/`Artist` columns when present
  (`<Artist> - <Title>`, stripped of `< > : " / \ | ? *` and trimmed), falling back to
  a sanitized version of the downloaded title for plain URL-list input. It renames
  the downloaded temp file to this sanitized stem before invoking `separate.py`, so
  `separate.py`'s own (unsanitized) `Path(audio_path).stem` derivation naturally
  produces the safe folder name without needing to patch `separate.py` itself.
- **No automatic retry beyond "run the script again."** The underlying Python scripts
  have zero retry/backoff logic themselves (confirmed by reading them), and this
  proposal doesn't add any inside a single run either — a failed song is logged and
  skipped for *this* run. Combined with the `ERROR`-rows-are-pending rule above,
  re-running the whole script is the retry mechanism, which is simple and sufficient
  for a human-supervised batch (the user can also just delete `ERROR` rows they don't
  want retried).
- **Output root defaults to `<repo>/output/stems` (dev layout) with a `--output-dir`
  override**, rather than trying to auto-detect a packaged app's `userData` path
  (which has no fixed location without invoking Electron). Documented in the script's
  `--help` text; the user in this proposal runs from a source checkout, matching the
  dev default.
- **5-second pause between real download attempts** (added after real-run testing
  surfaced a transient `403`/`[UPDATE_YTDLP]` failure from YouTube on the very next
  video after several rapid-fire downloads in a short test session — the same URL
  succeeded seconds later on manual retry, confirming it was rate-limiting, not a
  stale yt-dlp version). The pause is skipped when a row is resolved via the
  already-on-disk check (no network request made), so it only slows down rows that
  actually hit the network.

## Risks / Trade-offs

- [Long unattended run (potentially many hours for 105 songs) could be killed by the
  OS, sleep/power settings, or a terminal closing] → Mitigated by the per-song resume
  checkpointing (both the status column and the filesystem check) — an interrupted
  run loses at most the one song in flight, never earlier progress.
- [Duplicated path-resolution/spawn logic vs. `SetupManager`/`JobManager` could drift
  out of sync if those change] → Accepted, called out explicitly above; the script is
  small enough that keeping it in sync is a quick manual check, not a maintenance
  burden on par with the app's core paths.
- [YouTube/yt-dlp failures — private/unavailable/rate-limited videos — are common at
  105-URL scale] → Already handled by continuing past failures and recording
  `ERROR: <message>` per row (using `download.py`'s existing categorized error
  messages, e.g. `[UPDATE_YTDLP] ...`) rather than aborting the batch; the user gets a
  clear per-song audit trail to act on afterward.
- [Sanitizing/renaming introduces a second place that must agree with `separate.py`'s
  own folder-naming so songs the script produces still show up correctly in
  `scanSongsLibrary`] → Mitigated by *not* changing `separate.py`'s naming logic at
  all — the script controls the input filename's stem before calling `separate.py`,
  so `separate.py` needs no changes and the existing app-side scan logic (which only
  cares that a folder contains stem-prefixed files, not what the folder is named)
  is unaffected either way.

## Migration Plan

No data migration and no changes to shipped app code — this is a new, additive dev
script. Nothing to roll out to end users; nothing to roll back beyond deleting the
script if it turns out not to be wanted. The user runs it once against their current
`links.txt`; future batches (or re-runs to pick up retries) use the same command.
