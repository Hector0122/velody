## Purpose

Defines a persisted, per-song playback range (trim start/end) that lets a
long intro or outro be skipped automatically during playback and export,
without modifying the underlying audio files.

## ADDED Requirements

### Requirement: Trim range persists per song
The system SHALL store an optional trim start time and trim end time per
song, persisted so it survives closing and reopening the song.

#### Scenario: Setting a trim range and reopening the song
- **WHEN** the user sets a trim start and/or trim end for a song, then closes
  and reopens that song (including after restarting the app)
- **THEN** the previously set trim start/end SHALL still apply

#### Scenario: Song with no trim range set
- **WHEN** a song has never had a trim range set
- **THEN** it SHALL behave as fully untrimmed (playback starts at 0, plays to
  the natural end of the file)

### Requirement: Original audio files are never modified
Setting, changing, or clearing a trim range SHALL NOT modify the song's
underlying stem files on disk.

#### Scenario: Trim range set on a song
- **WHEN** the user sets a trim range for a song
- **THEN** the song's stem files SHALL be byte-for-byte unchanged on disk
- **AND** the song's cached BPM/key detection results SHALL remain valid and
  unaffected

### Requirement: Restart uses the trim start
Restarting playback (including the initial position when a song with a trim
range is opened) SHALL seek to the trim start instead of the beginning of
the file.

#### Scenario: Restarting a trimmed song
- **WHEN** the user restarts playback on a song with a trim start set
- **THEN** playback SHALL begin at the trim start position, not at time 0

### Requirement: Playback stops at the trim end
When a trim end is set and A/B loop is not active, playback SHALL stop
automatically upon reaching the trim end instead of continuing into the
remainder of the file.

#### Scenario: Playing a song with a trim end set, loop off
- **WHEN** playback reaches the trim end position and A/B loop is not
  enabled
- **THEN** playback SHALL stop at that position

#### Scenario: Trim end set, loop active on a range inside the trim
- **WHEN** A/B loop is enabled with loop bounds inside the trimmed range
- **THEN** looping SHALL continue to behave as it does today, unaffected by
  the trim end

### Requirement: Manual seeking is not restricted by the trim range
The user SHALL be able to seek/scrub to any position in the full song,
including before the trim start or after the trim end, to preview or adjust
the trimmed-out regions.

#### Scenario: Scrubbing into a trimmed-out region
- **WHEN** the user clicks or drags to a position before the trim start or
  after the trim end on the waveform
- **THEN** playback position SHALL move to that position, unrestricted by
  the trim range

### Requirement: Trimmed regions are visually indicated
The master timeline SHALL visually distinguish the trimmed-out regions
(before trim start, after trim end) from the playable range.

#### Scenario: Song with a trim start set
- **WHEN** a song has a trim start greater than 0
- **THEN** the region of the waveform before the trim start SHALL be
  visually dimmed relative to the playable range

### Requirement: Trim points can be set, edited, and cleared
The user SHALL be able to set the trim start and trim end to the current
playback position, and clear the trim range back to the untrimmed default.

#### Scenario: Setting trim start from the current position
- **WHEN** the user plays or seeks to a position and sets it as the trim
  start
- **THEN** that position SHALL become the song's persisted trim start

#### Scenario: Trim end before trim start is rejected
- **WHEN** the user attempts to set a trim end earlier than the current trim
  start
- **THEN** the system SHALL reject the change and leave the existing trim
  range unmodified

#### Scenario: Clearing the trim range
- **WHEN** the user clears the trim range
- **THEN** the song SHALL revert to untrimmed behavior (trim start 0, no
  trim end)

### Requirement: Exported audio matches the trimmed range
Exporting a mix or an individual stem SHALL apply the song's current trim
range to the exported audio by default.

#### Scenario: Exporting a song with a trim range set
- **WHEN** the user exports a mix or a single stem for a song that has a
  trim start and/or trim end set
- **THEN** the exported audio file SHALL begin at the trim start and (if a
  trim end is set) end at the trim end, rather than covering the full
  untrimmed source
