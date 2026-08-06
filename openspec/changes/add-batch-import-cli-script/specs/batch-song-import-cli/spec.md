## Purpose

Defines the behavior of the standalone `scripts/batch-import.mjs` CLI: how it reads a
links file, decides which rows to process, downloads and separates each song into
stems, and records outcomes so a long, unattended, multi-hour run is safe to
interrupt and resume.

## ADDED Requirements

### Requirement: Script reads a tab-separated or plain links file
The script SHALL accept a path to a text file (defaulting to `links.txt` in the
current working directory) containing one song per line, and SHALL support two line
formats: tab-separated rows of `#\tTitle\tArtist\tURL[\tstatus]`, and plain
one-URL-per-line rows. It SHALL skip a header row (a row whose URL column does not
contain a recognizable YouTube/YouTube Music URL) and SHALL skip blank rows.

#### Scenario: Spreadsheet-pasted links file
- **WHEN** the script is run against a tab-separated file whose first row is
  `#	Cancion	Autor	Link` followed by 105 data rows, each with a
  `music.youtube.com/watch?v=...` URL in the 4th column
- **THEN** the script SHALL skip the header row and process each of the 105 data rows

#### Scenario: Plain URL list
- **WHEN** the script is run against a file containing one bare YouTube URL per line
  with no tabs
- **THEN** the script SHALL treat each non-blank line as a URL to process

### Requirement: Already-completed rows are skipped
A row SHALL be treated as already done, and skipped without downloading, if its
status column is non-empty and does not start with `ERROR` (case-insensitive). This
includes status values not written by this script (e.g. a user's own prior manual
markers).

#### Scenario: Row already marked done by the user
- **WHEN** a row's status column contains `Listo` or `1`, written by the user before
  ever running the script
- **THEN** the script SHALL skip that row

#### Scenario: Row previously marked OK by the script
- **WHEN** a row's status column contains `OK` from a prior run of the script
- **THEN** the script SHALL skip that row on subsequent runs

#### Scenario: Row previously marked ERROR
- **WHEN** a row's status column contains `ERROR: <message>` from a prior run
- **THEN** the script SHALL treat the row as pending and attempt it again

### Requirement: Already-processed output on disk is also skipped
Independent of the status column, the script SHALL skip a URL if its computed output
folder already exists under the output stems root and contains at least one stem
file, so a regenerated or hand-edited links file does not cause redundant
reprocessing.

#### Scenario: Output folder already has stems
- **WHEN** `output/stems/<computed-song-folder>/` already contains `vocals.mp3` (or
  any other stem file) before the script runs
- **THEN** the script SHALL skip downloading/separating that song regardless of what
  the links file's status column says

### Requirement: Songs are processed one at a time
The script SHALL download and separate songs sequentially, never running more than
one download or one separation subprocess concurrently.

#### Scenario: Batch of multiple pending songs
- **WHEN** the links file has more than one pending row
- **THEN** the script SHALL fully complete (or fail) one song's download and
  separation before starting the next

### Requirement: A single song's failure does not abort the batch
If downloading or separating a song fails (network error, unavailable video, Demucs
error, timeout), the script SHALL record the failure for that row and continue
processing the remaining pending rows.

#### Scenario: One URL is private/unavailable
- **WHEN** one row's video is private or has been removed, causing `download.py` to
  emit an `error`
- **THEN** the script SHALL record `ERROR: <message>` for that row and proceed to the
  next pending row without stopping

### Requirement: Progress is checkpointed after every song
After each row is processed (success or failure), the script SHALL write the outcome
back into that row's status column in the links file on disk before moving to the
next row, so an interruption loses at most the song currently in progress.

#### Scenario: Script is interrupted mid-batch
- **WHEN** the script is stopped (e.g. terminal closed, process killed) after
  successfully completing song 40 of 105 and before starting song 41
- **THEN** re-running the script SHALL skip songs 1–40 (already marked `OK` or
  otherwise done) and resume from song 41

### Requirement: Output matches the app's existing library layout
Each successfully separated song SHALL be written to
`<output-dir>/<song-folder>/<stem>.mp3` for the standard stem set
(vocals/drums/bass/other/piano/guitar), using the same layout `separate.py` already
produces, with `<output-dir>` defaulting to the dev-mode stems root
(`output/stems` under the repo) and overridable via a `--output-dir` flag.

#### Scenario: Successfully processed song appears in the app
- **WHEN** the script successfully processes a song and the user later opens the
  Velody app pointed at the same `output/stems` root
- **THEN** the song SHALL appear in the app's song library without any additional
  steps

### Requirement: Output folder names are filesystem-safe
The script SHALL derive each song's output folder name from the links file's
Title/Artist columns when available (falling back to the downloaded video title for
plain-URL input), with characters unsafe on the target filesystem
(`< > : " / \ | ? *`) removed before the folder is created.

#### Scenario: Title contains unsafe characters
- **WHEN** a song's title or artist contains a character such as `:` or `?`
- **THEN** the resulting output folder name SHALL have that character stripped rather
  than passed through to the filesystem

### Requirement: BPM/key detection is not run by this script
The script SHALL only perform download and stem separation. It SHALL NOT invoke BPM
or key detection for any song; that detection remains a lazy, app-triggered step.

#### Scenario: Song processed by the batch script is opened in the app
- **WHEN** the user opens, in the app, a song that was produced by the batch script
- **THEN** BPM/key detection SHALL run exactly as it does for any other song (on
  first open, via the app's existing detection path), not have been pre-computed by
  the batch script
