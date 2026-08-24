## Purpose

Defines a manual, per-song correction for a detected tempo that's exactly
double or half the real tempo (a common beat-tracking failure mode), which
also rebuilds the detected beat-time grid so the metronome stays locked to
real audio transients at the corrected tempo rather than degrading to a
naive fixed-interval click.

## ADDED Requirements

### Requirement: User can halve or double a song's detected tempo
The user SHALL be able to correct a song's tempo by exactly halving or
doubling it.

#### Scenario: Doubling a tempo detected at half the real speed
- **WHEN** the user applies the "double tempo" correction to a song
- **THEN** the displayed BPM SHALL become exactly twice its previous value

#### Scenario: Halving a tempo detected at double the real speed
- **WHEN** the user applies the "halve tempo" correction to a song
- **THEN** the displayed BPM SHALL become exactly half its previous value

### Requirement: The correction preserves beat-grid-locked metronome scheduling
Applying a tempo correction SHALL keep the metronome following the song's
real, audio-onset-aligned beat positions, not fall back to a fixed-interval
click and not merely approximate the corrected positions arithmetically.

#### Scenario: Metronome after doubling
- **WHEN** the user applies the "double tempo" correction on a song with a
  detected beat grid
- **THEN** the metronome SHALL click at beat positions re-derived from the
  song's actual audio at the corrected tempo, not at a naive constant
  interval computed from the new BPM alone

#### Scenario: Non-quantized (human-performed) recording
- **WHEN** the user applies a tempo correction on a recording whose real
  beat timing has natural human variance (not a perfectly mechanical/
  quantized tempo)
- **THEN** the corrected beat positions SHALL still track the audio's real
  timing variance, rather than assuming perfectly uniform spacing between
  beats

### Requirement: The correction persists across reopening the song
A tempo correction SHALL be saved so it's still in effect the next time
the song is opened, without the user needing to reapply it.

#### Scenario: Reopening a corrected song
- **WHEN** the user applies a tempo correction, closes the song, and
  reopens it later
- **THEN** the corrected BPM and beat grid SHALL still be in effect,
  without re-running detection or requiring the user to correct it again
