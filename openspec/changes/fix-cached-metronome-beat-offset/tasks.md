## 1. Persist and reuse the first-beat offset

- [ ] 1.1 In `useSongAnalysis.ts`, bump `CACHE_VERSION` (e.g. 16 → 17) so caches written before this change (which never stored `firstBeatOffset`) are treated as stale.
- [ ] 1.2 In the cached-load branch, read `firstBeatOffset` from the cached metadata (guard for it being missing/non-numeric, matching the `_version` staleness check from 1.1) and set `firstBeatOffsetRef.current` to that value instead of hardcoding `0`.
- [ ] 1.3 In the fresh-detection branch's `saveMeta` call, include `firstBeatOffset: result.firstBeatOffset` alongside `bpm` and `_version`.
- [ ] 1.4 Double check `song:saveMeta`'s merge behavior (`{...existing, ...meta}`) still correctly preserves unrelated cached fields (e.g. detected key, markers) written by other hooks — no change expected here, just confirm.

## 2. Tests

- [ ] 2.1 Add/extend a renderer test for `useSongAnalysis` covering: a fresh detection caches both `bpm` and `firstBeatOffset`; a cache matching the current `CACHE_VERSION` reuses the cached `firstBeatOffset` (not `0`); a cache from an older `_version` triggers re-detection instead of reusing a missing offset.

## 3. Manual verification

- [ ] 3.1 Separate a new song (or clear its `.velody` cache), let BPM detection run, enable the metronome, and confirm the clicks land on the beat from the very start.
- [ ] 3.2 Close and reopen the same song (now served from cache) and confirm the metronome is still correctly aligned from the start, not offset.
