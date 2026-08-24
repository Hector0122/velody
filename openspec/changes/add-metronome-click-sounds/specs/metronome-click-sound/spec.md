## Purpose

Defines a selectable, persisted metronome click timbre used everywhere the
app plays a click — live playback, recording count-in, and exported click
tracks — so the click can be tuned to cut through a real mix instead of one
fixed, quiet default.

## ADDED Requirements

### Requirement: Click sound is selectable from a preset list
The system SHALL offer a small set of named metronome click sound presets
that the user can choose between.

#### Scenario: Viewing available presets
- **WHEN** the user opens the click sound control
- **THEN** the system SHALL present a fixed list of named presets,
  including at least one designed to be short and percussive and one
  matching today's original click sound

#### Scenario: Selecting a preset
- **WHEN** the user selects a preset
- **THEN** every metronome click played afterward SHALL use that preset's
  sound

### Requirement: Default click is percussive, not the original soft tone
For a user who has never chosen a preset, the metronome SHALL use a short,
percussive click by default rather than reproducing today's soft,
long-decay tone.

#### Scenario: First run with no preference set
- **WHEN** no click preset has ever been selected
- **THEN** the metronome SHALL play the percussive default preset, not the
  original soft tone

### Requirement: Click preset choice persists across app restarts
The selected click preset SHALL be remembered across closing and reopening
the app.

#### Scenario: Restarting after selecting a preset
- **WHEN** the user selects a click preset and restarts the app
- **THEN** the previously selected preset SHALL still be in effect

### Requirement: The selected preset applies everywhere a click plays
The chosen click preset SHALL apply consistently to the live in-playback
metronome, the recording count-in, and any other in-app metronome click,
using the same sound in every case.

#### Scenario: Same preset during live playback and recording count-in
- **WHEN** the user has selected a preset and both plays a song with the
  metronome on and starts a recording with a count-in
- **THEN** both SHALL produce clicks using the same selected preset

### Requirement: Exported click tracks match the selected preset
Exporting a mix with a metronome click track SHALL use the currently
selected click preset's sound, not an unrelated fixed tone.

#### Scenario: Exporting a mix with metronome
- **WHEN** the user exports a mix with the metronome click track option
  enabled
- **THEN** the click sound in the exported file SHALL match the currently
  selected preset
