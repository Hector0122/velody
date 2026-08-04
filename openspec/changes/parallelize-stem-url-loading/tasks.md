## 1. Parallelize URL resolution

- [ ] 1.1 In `useAudioContextEngine`'s URL-loading effect, replace the sequential `for (const stem of allStems) { result[key] = await window.api.getAudioUrl(stem) }` loop with a `Promise.all` over `allStems.map(...)` that resolves each stem's key/URL pair concurrently, then assembles the results into the same `Record<string, string>` shape.
- [ ] 1.2 Preserve current per-stem error handling behavior: if `getAudioUrl` can reject, ensure one stem's failure doesn't reject the whole `Promise.all` and drop successfully resolved stems (use `Promise.allSettled` or a per-call try/catch if `getAudioUrl` can throw) — check the current sequential code's implicit behavior (an unhandled rejection today would abort the loop entirely) and keep or deliberately improve on it per the spec's "partial results usable" requirement.
- [ ] 1.3 Keep the existing `cancelled` guard (`if (!cancelled) setUrls(result)`) working correctly with the new concurrent resolution.

## 2. Tests

- [ ] 2.1 Add/extend a renderer test asserting `getAudioUrl` is invoked for all stems without waiting on earlier calls to resolve first (e.g. mock it with staggered delays and assert results arrive bounded by the slowest call, not the sum).
- [ ] 2.2 Add a test for the partial-failure case: one stem's `getAudioUrl` rejects while others resolve, and the resolved stems still end up in `urls`.

## 3. Manual verification

- [ ] 3.1 Run `pnpm dev`, open a multi-stem song, and confirm all stems still load their audio and waveforms correctly with no regression in URL resolution.
