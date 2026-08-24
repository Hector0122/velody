## Purpose

Defines independent stereo panning for the metronome click and for the
overall stem mix, so a single stereo output can be split (via external
cabling) into a click-only feed and a mix feed for different listeners.

## ADDED Requirements

### Requirement: Metronome click can be panned independently
The user SHALL be able to set the metronome click's stereo pan position,
independent of every other sound in the app.

#### Scenario: Panning the click hard left
- **WHEN** the user sets the metronome pan to hard left
- **THEN** the metronome click SHALL be audible only (or predominantly) on
  the left channel
- **AND** no other sound (stems, recordings) SHALL be affected by this
  setting

### Requirement: The overall mix can be panned independently of the click
The user SHALL be able to set a pan position for the combined stem mix as a
whole, separate from the metronome's pan.

#### Scenario: Panning the mix hard right while the click is hard left
- **WHEN** the user sets the metronome pan to hard left and the mix pan to
  hard right
- **THEN** the metronome click SHALL be audible only (or predominantly) on
  the left channel
- **AND** the stem mix SHALL be audible only (or predominantly) on the
  right channel

### Requirement: Per-stem panning still applies within the mix pan
Existing per-stem pan settings SHALL continue to position each stem
relative to wherever the overall mix pan places the combined mix.

#### Scenario: A stem panned left, with the mix panned right
- **WHEN** an individual stem has a left pan setting and the master mix pan
  is set to the right
- **THEN** that stem SHALL sound left-of-center relative to the rest of the
  mix
- **AND** the overall mix (including that stem) SHALL still be positioned
  toward the right per the master mix pan

### Requirement: Both pan settings default to center and persist
Both the metronome pan and the mix pan SHALL default to center (no change
from today's behavior) until explicitly set, and SHALL persist across app
restarts once set.

#### Scenario: Default state
- **WHEN** neither pan has ever been set
- **THEN** both the metronome click and the mix SHALL play centered,
  identical to today's behavior

#### Scenario: Restarting after setting pan values
- **WHEN** the user sets the metronome pan and/or mix pan and restarts the
  app
- **THEN** the previously set pan values SHALL still be in effect
