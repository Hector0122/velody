## Purpose

Defines an on-demand, per-song way to try isolating a song's lead vocal
from its backing vocals/harmonies, using Mid/Side (center-channel)
extraction on the already-separated `vocals` stem — a best-effort mixing
heuristic, not a trained separation model, whose quality depends on how
the original recording was mixed.

## ADDED Requirements

### Requirement: User can trigger a lead/backing vocal split for a song
The user SHALL be able to trigger, on demand, a split of a song's `vocals`
stem into a lead-vocal-candidate stem and a backing-vocal-candidate stem.

#### Scenario: Running the split for the first time
- **WHEN** the user triggers the split on a song that has a `vocals` stem
  and no existing split
- **THEN** two new stems SHALL appear for that song, labeled as the lead
  vocal candidate and the backing vocal candidate
- **AND** the original `vocals` stem SHALL remain unchanged and still
  playable

### Requirement: The split is not run automatically
The lead/backing vocal split SHALL only run when the user explicitly
triggers it for a given song, never automatically during stem separation.

#### Scenario: A freshly separated song
- **WHEN** a song finishes stem separation
- **THEN** no lead-vocal-candidate or backing-vocal-candidate stem SHALL
  exist for it until the user explicitly triggers the split

### Requirement: Split stems behave like ordinary stems
Once created, the lead-vocal-candidate and backing-vocal-candidate stems
SHALL support the same mute, volume, and pan controls as any other stem.

#### Scenario: Muting the backing-vocal-candidate stem
- **WHEN** the user mutes the backing-vocal-candidate stem
- **THEN** playback SHALL silence only that stem, identical to muting any
  other stem

### Requirement: Re-running the split replaces the previous result
Triggering the split again for a song that already has one SHALL overwrite
the existing lead/backing candidate stems rather than creating additional
ones.

#### Scenario: Re-splitting after a poor first result
- **WHEN** the user triggers the split again on a song that already has
  lead/backing candidate stems
- **THEN** the previous two candidate stems SHALL be replaced by the new
  result
- **AND** no duplicate or extra stems SHALL be left over from the first run

### Requirement: The split stems can be deleted independently
The user SHALL be able to delete the lead-vocal-candidate and/or
backing-vocal-candidate stems without affecting the original `vocals` stem
or any other stem.

#### Scenario: Deleting an unhelpful split result
- **WHEN** the user deletes the backing-vocal-candidate stem because the
  split result wasn't useful for that song
- **THEN** that stem SHALL no longer appear or play
- **AND** the original `vocals` stem SHALL remain fully intact and playable
