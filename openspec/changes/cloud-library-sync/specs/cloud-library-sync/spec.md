# Spec Delta

## Purpose

Lets the desktop app keep a personal cloud copy of the stem library, so songs
can be backed up, removed from the laptop to free space, and re-downloaded on
demand, while the app stays fully usable offline.

## ADDED Requirements

### Requirement: Cloud sync is optional and off by default
Cloud features SHALL be active only after the user enters a backend URL and
token and enables sync. While disabled, the song list, playback, separation,
analysis and export SHALL behave exactly as without this feature.

#### Scenario: Fresh install
- **WHEN** the user has never configured the cloud
- **THEN** no network request to the cloud backend SHALL be made and no sync controls other than the settings entry SHALL be shown

#### Scenario: Testing the connection
- **WHEN** the user enters a URL and token and presses "Test connection"
- **THEN** the app SHALL report success or the specific failure (unreachable, invalid token)

### Requirement: The token is stored encrypted
The personal token SHALL be stored using the operating system's credential
encryption, never in plain text on disk or in renderer storage.

#### Scenario: Saving the token
- **WHEN** the user saves the cloud settings
- **THEN** the token SHALL be persisted encrypted and SHALL NOT be readable from the renderer process

### Requirement: Each song shows its sync state
With cloud enabled, every song in the library list SHALL show one of: synced
(local + cloud), cloud only, local only, or in transfer with progress.

#### Scenario: Merged library list
- **WHEN** the library contains song A only locally, song B only in the cloud, and song C in both
- **THEN** the list SHALL show A as local only, B as cloud only, and C as synced, with no duplicates

#### Scenario: Cloud unreachable
- **WHEN** cloud is enabled but the backend cannot be reached
- **THEN** local songs SHALL still be listed and playable, cloud-only songs SHALL be hidden or marked unavailable, and the app SHALL show a non-blocking offline indicator

### Requirement: Uploading a song
The user SHALL be able to upload a local-only song; once complete it becomes
synced. Uploading SHALL never modify or remove local files.

#### Scenario: Upload a song
- **WHEN** the user chooses "Upload" on a local-only song
- **THEN** all its stem files and its metadata SHALL be uploaded with visible progress and the song SHALL become synced

#### Scenario: Upload interrupted
- **WHEN** an upload fails or the app quits midway
- **THEN** the song SHALL remain local only, and retrying SHALL not re-send files that already reached the cloud

#### Scenario: Upload all
- **WHEN** the user chooses "Upload all local songs"
- **THEN** every local-only song SHALL be uploaded one after another, with overall and per-song progress, and a failure on one song SHALL not stop the others

### Requirement: Downloading a song
The user SHALL be able to download a cloud-only song; opening a cloud-only
song SHALL download it first and then open it normally.

#### Scenario: Open a cloud-only song
- **WHEN** the user opens a cloud-only song while online
- **THEN** the app SHALL download its files with visible progress, then load it into the player, and the song SHALL become synced

#### Scenario: Download failure leaves no partial song
- **WHEN** a download fails midway
- **THEN** no partially written song folder SHALL appear in the local library and the song SHALL remain cloud only

#### Scenario: Corrupted download
- **WHEN** a downloaded file's size or hash does not match the cloud index
- **THEN** the download SHALL fail and the file SHALL be discarded

### Requirement: Removing the local copy
For a synced song, "Remove from this laptop" SHALL delete its local folder
and keep the cloud copy, leaving the song cloud only.

#### Scenario: Free local space
- **WHEN** the user removes the local copy of a synced song
- **THEN** its local files SHALL be deleted, it SHALL remain in setlists, and it SHALL be listed as cloud only

#### Scenario: Not offered for unsynced songs
- **WHEN** a song is local only, or its local metadata is newer than the cloud's and cannot be pushed
- **THEN** "Remove from this laptop" SHALL be unavailable or SHALL first push the metadata, so no data exists only on the laptop when its files are deleted

### Requirement: Deleting everywhere requires confirmation
"Delete everywhere" SHALL remove the song from the laptop and the cloud only
after an explicit confirmation that states it cannot be undone.

#### Scenario: Confirmed delete
- **WHEN** the user confirms "Delete everywhere" on a synced song
- **THEN** the song SHALL be deleted from the cloud and locally, and pruned from every setlist

#### Scenario: Cancelled delete
- **WHEN** the user dismisses the confirmation
- **THEN** nothing SHALL be deleted

#### Scenario: Cloud delete fails
- **WHEN** the cloud deletion fails
- **THEN** the local copy SHALL NOT be deleted and the user SHALL see the error

### Requirement: Metadata stays in sync with last-write-wins
Each song's metadata (BPM grid, markers, trim, count-in, practice settings,
downbeat) SHALL carry an `updatedAt`; on open, upload and download the newer
side SHALL win.

#### Scenario: Edited on the laptop
- **WHEN** a synced song's metadata is changed locally and the song is next synced
- **THEN** the cloud metadata SHALL be replaced by the local one

#### Scenario: Cloud is newer
- **WHEN** a synced song is opened and the cloud metadata is newer than the local one
- **THEN** the local metadata SHALL be replaced by the cloud one before the song loads

#### Scenario: Offline edits
- **WHEN** metadata is edited while offline
- **THEN** the edit SHALL be kept locally and pushed on the next successful sync of that song

### Requirement: Song identity is stable across renames and devices
Each uploaded song SHALL have a stable cloud id independent of its folder
name, so the same song is recognized on every device.

#### Scenario: Re-downloading a song
- **WHEN** a song is removed locally and later downloaded again
- **THEN** it SHALL keep the same cloud id, name and metadata, and SHALL appear in its setlists as before
