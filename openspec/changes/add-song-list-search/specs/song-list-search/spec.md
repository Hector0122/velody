## Purpose

Defines how the user can filter the sidebar's song list by name, so that a
large library (100+ songs) can be searched instead of scanned visually.

## ADDED Requirements

### Requirement: Song list has a search input
The sidebar's Recent Songs section SHALL display a text input above the song
list that filters visible entries as the user types.

#### Scenario: Typing a query filters the list
- **WHEN** the user types text into the search input
- **THEN** the Recent Songs list SHALL show only songs whose name contains
  that text, evaluated case-insensitively, updating on every keystroke

#### Scenario: Clearing the query restores the full list
- **WHEN** the search input is emptied (cleared or all text deleted)
- **THEN** the Recent Songs list SHALL show every song again, in the same
  order as before any filtering

### Requirement: No-match state is communicated
When the current search text matches no song, the list SHALL show an
explicit "no results" message rather than rendering an empty, ambiguous gap.

#### Scenario: Query matches nothing
- **WHEN** the search text does not match any song name
- **THEN** the Recent Songs list SHALL render a message indicating no songs
  were found, instead of an empty list

### Requirement: Search does not affect other sidebar sections
Filtering the song list SHALL NOT change what is shown in the Queue section
or any other part of the sidebar.

#### Scenario: Queue stays visible while searching
- **WHEN** the user has active/queued jobs in the Queue section and types a
  search query
- **THEN** the Queue section SHALL continue to show all its entries
  unaffected by the search text
