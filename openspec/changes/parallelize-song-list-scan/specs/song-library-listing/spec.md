## Purpose

Defines how the app enumerates the local library of separated songs, so that
listing a library with many songs does not pay a cumulative, sequential
filesystem-scan cost.

## ADDED Requirements

### Requirement: Song directories are scanned concurrently
When listing the song library, the system SHALL scan each candidate song
directory (checking whether it is a directory and reading its stem files)
concurrently rather than waiting for one song directory's scan to complete
before starting the next.

#### Scenario: Listing a library with many songs
- **WHEN** the stems root directory contains N song subdirectories
- **THEN** the system SHALL scan all N directories without waiting for
  earlier ones to complete first, so total scan time is not the sum of N
  sequential per-directory filesystem operations

### Requirement: Listing result is unchanged by concurrency
Scanning directories concurrently SHALL NOT change which songs are included,
their stem lists, or their final sort order compared to the current
sequential behavior.

#### Scenario: Only directories with recognized stems are included
- **WHEN** the stems root directory contains a subdirectory with no
  recognized stem files
- **THEN** that subdirectory SHALL still be excluded from the returned list,
  identical to today's behavior

#### Scenario: Result order is stable
- **WHEN** the song list is returned
- **THEN** it SHALL be sorted the same way as today (by name, descending),
  regardless of the order in which concurrent directory scans complete
