## Purpose

Defines how per-stem and master waveforms are computed for display, so that
waveform rendering reuses audio the playback engine has already decoded
instead of independently re-fetching and re-decoding the same audio file.

## ADDED Requirements

### Requirement: Waveform rendering reuses the playback engine's decoded audio
When the playback engine has already decoded a stem's audio into an in-memory
audio buffer, the waveform renderer for that stem SHALL use that decoded
buffer to compute and draw its waveform instead of independently fetching and
decoding the audio file a second time.

#### Scenario: Stem waveform shown after playback engine decodes the stem
- **WHEN** a stem's audio has already been decoded by the playback engine
- **THEN** creating that stem's waveform display SHALL NOT issue a separate
  full fetch-and-decode of the same audio file

#### Scenario: Waveform requested before the playback engine has decoded the stem
- **WHEN** a stem's waveform is requested before the playback engine has
  finished decoding that stem's audio
- **THEN** the waveform SHALL become available once decoding completes,
  without silently failing or requiring the user to retry

### Requirement: Waveform display is visually and temporally unaffected
Removing the redundant decode SHALL NOT change what the user sees or hears:
waveform shape, duration, and playback-position synchronization SHALL be
identical to the current (pre-change) behavior.

#### Scenario: Waveform shape and duration unchanged
- **WHEN** a song with multiple stems is opened
- **THEN** each stem's rendered waveform SHALL reflect the same audio content
  and duration as before, indistinguishable to the user from independently
  decoded waveforms

#### Scenario: Deleting a recorded stem still cleans up its waveform
- **WHEN** a user deletes a recorded stem
- **THEN** that stem's waveform display and any resources tied to it SHALL
  still be torn down correctly, consistent with existing deletion behavior
