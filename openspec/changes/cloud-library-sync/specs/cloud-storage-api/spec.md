# Spec Delta

## Purpose

Defines the personal cloud backend contract (hosted on Cloudflare) that stores
the stem library and its metadata, consumed by the desktop app now and by the
mobile companion app later.

## ADDED Requirements

### Requirement: Every request is authenticated with a personal token
The API SHALL reject any request that does not carry the configured personal
bearer token, without revealing whether any song or file exists.

#### Scenario: Missing or wrong token
- **WHEN** a request arrives with no `Authorization` header or a token that does not match
- **THEN** the API SHALL respond 401 and SHALL NOT return song data or URLs

#### Scenario: Valid token
- **WHEN** a request carries the configured token
- **THEN** the API SHALL process it normally

### Requirement: Storage credentials never leave the backend
Clients SHALL receive only short-lived presigned URLs for file transfer; the
storage bucket's access keys SHALL exist only as backend secrets.

#### Scenario: Requesting transfer URLs
- **WHEN** a client asks to upload or download a song's files
- **THEN** the API SHALL return per-file presigned URLs that expire within 1 hour, and no long-lived credential

### Requirement: Song index listing
The API SHALL list every cloud song with its id, display name, file list
(stem name, size in bytes, content hash), and metadata `updatedAt`.

#### Scenario: Listing songs
- **WHEN** an authenticated client requests the song list
- **THEN** the API SHALL return all songs that have completed upload, each with its files and `updatedAt`

#### Scenario: Incomplete upload is hidden
- **WHEN** a song upload was started but never committed
- **THEN** that song SHALL NOT appear in the song list

### Requirement: Upload is a two-step begin/commit
A client SHALL begin an upload by declaring the song id, name and files
(name, size, hash) to get presigned upload URLs, then commit it; the API
SHALL verify every declared file exists in storage with the declared size
before marking the song complete.

#### Scenario: Successful commit
- **WHEN** all declared files were uploaded and the client commits
- **THEN** the song SHALL become visible in the song list

#### Scenario: Commit with a missing file
- **WHEN** the client commits but a declared file is absent or its size differs
- **THEN** the API SHALL respond with an error naming the missing files and the song SHALL stay hidden

#### Scenario: Re-upload skips unchanged files
- **WHEN** a client begins an upload for a song whose file already exists in the cloud with the same hash
- **THEN** the API SHALL omit that file from the URLs it returns

### Requirement: Song metadata storage with last-write-wins
The API SHALL store one metadata JSON document per song with an `updatedAt`
timestamp, and SHALL accept a metadata write only if its `updatedAt` is newer
than the stored one.

#### Scenario: Newer metadata
- **WHEN** a client writes metadata whose `updatedAt` is newer than the stored one
- **THEN** the API SHALL store it and return the stored `updatedAt`

#### Scenario: Stale metadata
- **WHEN** a client writes metadata whose `updatedAt` is older than or equal to the stored one
- **THEN** the API SHALL respond 409 with the current stored metadata, and SHALL NOT overwrite it

### Requirement: Song deletion
The API SHALL delete a song's index entry, metadata and every stored file in
one request.

#### Scenario: Deleting a song
- **WHEN** an authenticated client deletes a song by id
- **THEN** the song SHALL disappear from the list and its files SHALL no longer be downloadable

#### Scenario: Deleting an unknown song
- **WHEN** the id does not exist
- **THEN** the API SHALL respond 404 and change nothing
