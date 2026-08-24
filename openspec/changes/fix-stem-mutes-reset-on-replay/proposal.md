## Why

Found the exact cause in `useAudioContextEngine.ts`: `toggleMasterPlay`'s
"starting from stopped" branch unconditionally rebuilds the `active` map as
**every stem set to `true`** —
```ts
const all: Record<string, boolean> = {}
for (const path of allStems) {
  const key = stemNameFromPath(path)
  all[key] = true
  ...
}
...
setActive(all)
```
— every single time playback starts from a stopped state, not just the
first time. So if the user mutes a couple of stems, stops (e.g. to fix a
mistake in rehearsal), and presses Play again, every stem — including the
ones they just muted — comes back active, and they have to re-mute them by
hand. This happens every stop/restart cycle, which is exactly the kind of
thing that gets tedious and error-prone in a live rehearsal or show. Notably
`toggleStem` (the per-stem play button, when master is paused) does **not**
have this problem — it only activates the one clicked stem
(`{ ...activeRef.current, [key]: true }`), preserving everything else — so
this is an inconsistency in `toggleMasterPlay` specifically, not a
deliberate design choice applied consistently across the two start paths.

## What Changes

- `toggleMasterPlay`'s start-from-stopped branch stops force-activating
  every stem on every restart. Instead, it only defaults a stem to active
  if it has no existing entry in the `active` map yet (i.e., a stem never
  touched before — most commonly, the very first time the song is played,
  or a newly recorded stem that just got added to the grid).
- Any stem the user has explicitly muted (or soloed-out) stays muted across
  Stop → Play, Restart, and pause/resume — the user's mute choices persist
  for the rest of the session until they change them again.
- No change to `toggleStem`'s existing per-stem-start behavior, which
  already does this correctly.

## Capabilities

### New Capabilities
- `stem-mute-state`: How each stem's active/muted state behaves across
  starting, stopping, and restarting playback within a session.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/hooks/useAudioContextEngine.ts`: `toggleMasterPlay`'s
  start-from-stopped branch.
- No IPC, persistence, or export changes — this is in-session `active`
  state behavior only (mutes are not persisted across closing/reopening the
  song today, and this proposal doesn't change that — only that they now
  survive stop/restart *within* a session, which is the reported problem).
