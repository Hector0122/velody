## Purpose

Defines how the metronome keeps its clicks aligned with a song's actual
tempo over the full duration of playback, rather than drifting away from a
single constant-tempo projection as the song progresses.

## ADDED Requirements

### Requirement: Metronome uses the detected beat grid when available
When a detected beat-time grid is available for the current song and the
displayed BPM has not been manually overridden, the metronome SHALL schedule
its clicks from the actual detected beat positions rather than a
constant-tempo projection from a single BPM value.

#### Scenario: Song with a detected beat grid plays for several minutes
- **WHEN** the metronome is enabled for a song whose beat grid was detected
  and the user has not changed the BPM
- **THEN** each click SHALL be scheduled at the corresponding detected beat
  time, so alignment does not depend on how long the song has been playing

### Requirement: Falls back to constant-tempo scheduling when no grid applies
When no detected beat grid is available for the current song, or when
playback has advanced past the last detected beat, the metronome SHALL fall
back to scheduling clicks by extrapolating from a constant tempo, matching
today's behavior.

#### Scenario: No beat grid was detected
- **WHEN** a song has a detected BPM and first-beat offset but no beat-time
  grid (e.g. the grid failed to detect, or is unavailable for legacy cached
  data)
- **THEN** the metronome SHALL schedule clicks using constant-tempo
  extrapolation from the BPM and offset, unchanged from current behavior

#### Scenario: Playback continues past the last detected beat
- **WHEN** the song plays beyond the last beat time present in the detected
  grid
- **THEN** the metronome SHALL continue scheduling clicks by extrapolating
  forward from the last detected beat at the current tempo, without a gap or
  duplicate click at the transition

### Requirement: Manual tempo override bypasses the detected grid
When the user manually changes the displayed BPM away from the originally
detected value, the metronome SHALL schedule clicks using the user's chosen
constant tempo rather than the detected beat grid, since the grid no longer
corresponds to the tempo the user has asked for.

#### Scenario: User adjusts BPM during playback
- **WHEN** the metronome is using the detected beat grid and the user
  manually changes the BPM
- **THEN** subsequent clicks SHALL be scheduled from constant-tempo
  extrapolation at the new user-chosen BPM, not the original detected grid

#### Scenario: User later resets BPM to the detected value
- **WHEN** the user changes the BPM back to the originally detected value
- **THEN** the metronome SHALL resume using the detected beat grid for
  scheduling
