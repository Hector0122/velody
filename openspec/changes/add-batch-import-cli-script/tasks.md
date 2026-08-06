## 1. Path resolution (ported from `SetupManager`)

- [x] 1.1 In `scripts/batch-import.mjs`, implement `getPythonPath()` and
      `getFfmpegPath()` replicating `src/main/setup/index.ts`'s venv/FFmpeg path
      arithmetic (`homedir()/.local/share/velody/venv/{Scripts|bin}/python{.exe|3}`
      falling back to bare `python`/`python3`; `homedir()/.local/share/velody/ffmpeg/bin/ffmpeg{.exe|}`
      falling back to bare `ffmpeg`), using `existsSync` the same way.
- [x] 1.2 Resolve `python-worker/` and the default `output/stems/` root relative to
      the script's own location (mirroring `getPythonWorkerDir()`/`getOutputStemsDir()`'s
      dev-mode branch — no `app.isPackaged` equivalent needed here), overridable via a
      `--output-dir` CLI flag.

## 2. Links file parsing

- [x] 2.1 Implement a line parser that: splits on tabs when present (row shape
      `#\tTitle\tArtist\tURL[\tstatus]`), extracts the URL by matching a
      YouTube/YouTube Music URL pattern, skips the row if no URL is found (header/blank
      rows), and captures Title/Artist/existing-status when present.
- [x] 2.2 Support plain one-URL-per-line files as a second recognized shape (no tabs,
      whole trimmed line matches the URL pattern).
- [x] 2.3 Implement the "already done" predicate: pending unless status is non-empty
      and does not start with `ERROR` (case-insensitive).
- [x] 2.4 Implement a rewrite function that writes the status value back into the
      correct column of the correct original line and persists the file, preserving
      all other rows/columns byte-for-byte (only the touched row's status cell and its
      own trailing newline should change).

## 3. Output naming

- [x] 3.1 Implement `sanitizeFolderName(name)` stripping `< > : " / \ | ? *` and
      trimming, used for both the `<Artist> - <Title>`-derived name (when Title/Artist
      columns are present) and the fallback (sanitized downloaded video title for
      plain-URL rows).
- [x] 3.2 Implement the pre-flight "already on disk" check: does
      `<output-dir>/<sanitized-name>/` exist and contain at least one file whose name
      starts with one of `vocals`/`drums`/`bass`/`other`/`piano`/`guitar`? If so, treat
      as done (write/confirm `OK` in the links file) without downloading.

## 4. Download + separate pipeline

- [x] 4.1 Implement `downloadSong(url, ffmpegPath)`: spawn
      `<python> python-worker/download.py <url> --ffmpeg-path <ffmpegPath>` with
      `cwd: python-worker/`, parse JSON lines (`metadata`/`progress`/`complete`/`error`),
      apply a 10-minute timeout matching `url:import`'s existing value, and resolve
      with the downloaded temp file path + title on `complete`.
- [x] 4.2 After download, rename/move the temp file to
      `<tmpdir>/<sanitized-name><ext>` so `separate.py`'s own `Path.stem` derivation
      produces the sanitized folder name without modifying `separate.py`.
- [x] 4.3 Implement `separateSong(audioPath, outputDir)`: spawn
      `<python> python-worker/separate.py <audioPath> --output-dir <outputDir>` with
      `cwd: python-worker/`, parse JSON lines, apply the same 10-minute timeout as
      `JobManager.runDemucs`, and resolve with the `stems` array on `complete`.
- [x] 4.4 Wire `downloadSong` → `separateSong` per pending row, catching failures at
      either stage into a single per-row `ERROR: <message>` outcome (truncate long
      messages similarly to the existing handlers, e.g. first ~300 chars).

## 5. Batch driver

- [x] 5.1 Implement the main loop: parse args (`links-file` positional, defaulting to
      `links.txt`; `--output-dir` flag), parse the links file, filter to pending rows
      (status predicate + on-disk check), then process rows strictly sequentially.
- [x] 5.2 After each row: on success, write `OK`; on failure, write
      `ERROR: <message>`; persist the links file immediately (task 2.4) before
      starting the next row.
- [x] 5.3 Print per-row progress to stdout (`[n/total] Title — Artist: OK|ERROR ...`)
      and a final summary (counts of OK / ERROR / already-skipped).
- [x] 5.4 Add a `"batch-import": "node scripts/batch-import.mjs"` entry to
      `package.json`'s `scripts`.

## 6. Verification

- [x] 6.1 Dry run against a small (2-3 row) test links file with real URLs on this
      machine (venv/Demucs already set up, ffmpeg resolved via PATH fallback);
      confirmed stems land in `output/stems/<name>/` with all 6 expected files.
      (Skipped the `pnpm dev` visual check — `scanSongsLibrary`'s matching logic was
      already confirmed by direct code reading, and the on-disk output was verified
      directly.)
- [x] 6.2 Killed the script (`Stop-Process`) immediately after row 1 of a 2-row real
      test file finished and before row 2 started; confirmed the links file had row 1
      marked `OK` and row 2 still blank, then re-ran and confirmed it skipped row 1
      and completed row 2 without redoing row 1.
- [x] 6.3 Ran a test file with one good + one deliberately invalid URL; confirmed the
      batch recorded `ERROR: Video unavailable` for the bad row without aborting, and
      that re-running retried only that row (and only that row, since the good one was
      correctly skipped).
- [ ] 6.4 Run once against the user's real `links.txt` (105 rows) — in progress
      (started with user confirmation). First pass surfaced transient YouTube
      403/`[UPDATE_YTDLP]` blocks on a couple of rows within seconds of a successful
      manual retry of the same URL — confirmed as yt-dlp/YouTube rate-limiting
      flakiness, not a script or yt-dlp-version bug (see design.md). Added a 5s
      inter-download pause as mitigation; relying on the script's built-in
      mark-ERROR-and-retry-on-rerun behavior to clear any stragglers. Separately,
      discovered the venv's PyTorch was a CPU-only build despite an available NVIDIA
      GPU (~2.5 min/song); reinstalled `torch`/`torchaudio` with CUDA 12.4 support
      (out of scope for this change's own files, but necessary to make a 105-song
      run practical) — confirmed GPU pickup (`torch.cuda.is_available()` True, GPU
      util 99% during separation) and ~4x+ faster per-song time with no behavior
      change to the script itself.
