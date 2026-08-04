## Purpose

Defines how the app determines and reuses a song's first-beat offset so that
metronome clicks stay phase-aligned with the actual music on every play of a
song, not only the first time it is analyzed.

## ADDED Requirements

### Requirement: First-beat offset is cached alongside BPM
When a song's BPM and first-beat offset are freshly detected, the system
SHALL persist both values together so a later load of the same song can
reuse the correct offset instead of losing it.

#### Scenario: Fresh detection persists the offset
- **WHEN** BPM detection runs for a song for the first time and returns a
  first-beat offset
- **THEN** that offset SHALL be written to the song's cached metadata
  alongside the detected BPM

### Requirement: Cached loads reuse the real first-beat offset
When a song's BPM is loaded from cache, the system SHALL use the cached
first-beat offset for metronome alignment instead of assuming the first beat
occurs at the start of the track.

#### Scenario: Reopening a previously analyzed song
- **WHEN** a song whose BPM was already cached is opened again
- **THEN** the metronome SHALL use the previously detected first-beat offset,
  not zero, to align its clicks

### Requirement: Stale caches without a stored offset are re-analyzed
A cache written before first-beat offsets were persisted SHALL be treated as
stale so it is re-analyzed once rather than silently defaulting to an
incorrect offset indefinitely.

#### Scenario: Loading a cache from before this change
- **WHEN** a song's cached metadata was written by a version of the app that
  did not store a first-beat offset
- **THEN** the system SHALL re-run detection for that song instead of reusing
  the incomplete cached entry
