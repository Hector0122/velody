## Why

The user has a list of 105 YouTube Music URLs (title, artist, link — pasted from a
spreadsheet, tab-separated) they want turned into stems. Today the only way to get a
song into Velody is one at a time through the UI: paste a URL, wait for
`url:import` to download it, watch it move through the `JobManager` separation queue,
repeat. `JobManager` is already a strict one-at-a-time FIFO queue, so there is no
speed to gain from parallelism — the actual problem is that driving 105 rounds of
"paste URL, wait, confirm, next" through the UI is tedious and error-prone (easy to
lose track of which songs are done, easy to fat-finger a URL). There's no unattended
way to hand the app a list and walk away.

The renderer, `JobManager`, and `url:import`'s IPC handler are all Electron-coupled
(`BrowserWindow`, `app.getPath`), so they can't run headless. The underlying work —
`python-worker/download.py` then `python-worker/separate.py`, each already speaking a
JSON-lines stdout protocol — has no such coupling and can be driven directly from a
plain Node script outside Electron entirely.

## What Changes

- Add a standalone Node CLI script (`scripts/batch-import.mjs`, run via
  `node scripts/batch-import.mjs [file] [--output-dir <dir>]`, no new dependency —
  plain ESM, no ts-node/tsx required) that reads a list of YouTube/YouTube Music URLs
  from a text file (defaulting to `links.txt` in the current directory) and, for each
  one not already done, downloads it (`download.py`) and separates it into stems
  (`separate.py`), writing into the same `output/stems/<song>/` layout the app already
  scans — so processed songs just show up in the library next time the app is opened.
- Support the user's actual file format directly: tab-separated rows of
  `#  Title  Artist  URL  [status]`, as pasted from a spreadsheet (their real
  `links.txt` is exactly this), while also accepting a plain one-URL-per-line file.
  The header row and blank rows are skipped automatically.
- Make the run resumable and interruption-safe: after each song, write a status back
  into the row's status column (`OK` or `ERROR: <reason>`) and persist the file, so
  stopping the script (or a crash) and re-running it later picks up where it left off
  — rows already marked done (including the user's own pre-existing `Listo`/`1`
  markers) are skipped, and rows marked `ERROR` are retried automatically. Also skip
  a URL outright if its target output folder already contains stems on disk, even if
  the status column doesn't say so.
- Process songs strictly one at a time (matching `JobManager`'s existing concurrency
  model) and keep going past a single song's failure — log it and move to the next —
  since aborting a 105-song unattended run over one bad link would defeat the point.
- Explicitly do **not** run BPM/key detection as part of this script; that stays a
  lazy, on-demand step the app performs (via its existing singleflight-guarded
  `song:detectBpm`) the first time each song is opened, unchanged.

## Capabilities

### New Capabilities
- `batch-song-import-cli`: A standalone, headless command that turns a text file of
  YouTube/YouTube Music URLs into separated stems on disk, resumable across runs.

### Modified Capabilities
(none — this adds a new, separate entry point; it does not change `url:import`,
`JobManager`, or any existing IPC surface)

## Impact

- New: `scripts/batch-import.mjs`.
- New: `package.json` script entry (e.g. `"batch-import": "node scripts/batch-import.mjs"`).
- Reads/writes: the user-supplied links file (e.g. `links.txt`) in place, and the
  `output/stems/` directory tree also used by `songs:list`/`scanSongsLibrary`
  (`src/main/ipc/handlers.ts`).
- Reuses (by re-implementing the relevant ~30-40 lines directly in the script, not by
  importing them — see design.md): the venv Python / bundled FFmpeg path resolution
  currently in `src/main/setup/index.ts` (`SetupManager.getPythonPath()` /
  `getFfmpegPath()`), and the `download.py` → `separate.py` spawn + JSON-lines
  protocol pattern currently in `src/main/ipc/handlers.ts` (`url:import`) and
  `src/main/jobs/JobManager.ts` (`runDemucs`).
- No changes to `src/main/**`, `src/renderer/**`, `src/preload/**`, or
  `python-worker/**` — this is purely a new, additive entry point.
