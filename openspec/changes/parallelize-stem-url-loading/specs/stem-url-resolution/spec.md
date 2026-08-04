## Purpose

Defines how the app resolves playable URLs for a song's stem files, so that
resolving multiple independent stems' URLs does not pay a cumulative,
sequential latency cost.

## ADDED Requirements

### Requirement: Stem URLs are resolved concurrently
When a song has multiple stems, the system SHALL resolve each stem's playable
URL concurrently rather than waiting for one stem's URL to resolve before
starting the next.

#### Scenario: Opening a multi-stem song
- **WHEN** a song with N stems is opened
- **THEN** the system SHALL issue all N URL-resolution requests without
  waiting for earlier ones to complete first, so total resolution time is
  not the sum of N sequential round-trips

### Requirement: Partial URL resolution results are usable
Resolving stem URLs concurrently SHALL NOT change which stems successfully
get a URL versus fail — a failure resolving one stem's URL SHALL NOT prevent
other stems whose URLs resolved successfully from being usable.

#### Scenario: One stem fails to resolve while others succeed
- **WHEN** one stem's URL resolution fails while the other stems' resolutions
  succeed
- **THEN** the successfully resolved stems SHALL still be usable for playback
  and waveform rendering
