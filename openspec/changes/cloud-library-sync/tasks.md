# Tasks

## 1. Shared API contract

- [x] 1.1 Add `src/shared/cloud.ts` with request/response types for every `/v1` endpoint (design D4) and `SongSyncState`; verify `pnpm typecheck` passes

## 2. Cloudflare Worker (`cloud-worker/`)

- [x] 2.1 Scaffold `cloud-worker/` (own `package.json`, `wrangler.toml` with `BUCKET`/`DB` bindings, `tsconfig.json`, plain-Node vitest with a `node:sqlite` D1 adapter + in-memory R2 fake so the real migration SQL is tested); kept out of the desktop tsc/vitest globs, linted by the root eslint; verify `pnpm -C cloud-worker typecheck` and root `pnpm lint` both pass
- [x] 2.2 Add `migrations/0001_init.sql` (design D3 tables); verify `wrangler d1 migrations apply velody --local` succeeds
- [x] 2.3 Implement bearer-token auth middleware with constant-time compare and `GET /v1/health`; verify tests for missing/wrong/valid token (401/401/200)
- [x] 2.4 Implement presigning helper (`aws4fetch`, 1 h expiry); verify a unit test that generated URLs contain the expected key and `X-Amz-Expires=3600`
- [x] 2.5 Implement `POST /songs/:id/upload` and `POST /songs/:id/commit` (pending→complete, size check via R2 `head`, skip files with same sha256); verify tests: commit success, commit with missing file lists it, re-upload omits unchanged file, pending songs hidden from `GET /songs`
- [x] 2.6 Implement `GET /songs` and `GET /songs/:id/download`; verify tests for listing shape and 404 on unknown id
- [x] 2.7 Implement `GET/PUT /songs/:id/meta` with LWW (409 + current on stale, reject `updatedAt` > now + 1 day); verify tests for newer, equal, older, future timestamps
- [x] 2.8 Implement `DELETE /songs/:id` (R2 prefix + D1 rows); verify tests: song gone from list, objects gone, 404 on unknown id
- [x] 2.9 Write `cloud-worker/README.md` with the setup commands (bucket, D1 create + migrate, R2 S3 token, `wrangler secret put` ×4, deploy, token rotation); verify by following it against the user's Cloudflare account and hitting `/v1/health`

## 3. Desktop main process: settings and client

- [x] 3.1 Add `src/main/cloud/settings.ts` (URL, enabled flag, token encrypted with `safeStorage` in `<userData>/cloud.json`); verify unit tests that the file never contains the plain token and that unconfigured → disabled
- [x] 3.2 Add `src/main/cloud/client.ts` (typed fetch client, timeouts, retry on network/5xx only); verify unit tests with a mocked `fetch` for retry and 401 handling
- [x] 3.3 Register IPC `cloud:getSettings`, `cloud:saveSettings`, `cloud:test` and expose them in preload + `index.d.ts`; verify `pnpm typecheck` and that `cloud:getSettings` returns no token

## 4. Desktop main process: sync engine

- [x] 4.1 Make `updateMeta()` stamp `updatedAt` on every write; verify existing `updateMeta` tests still pass plus a new test for the stamp
- [x] 4.2 Add streaming SHA-256 with `fileHashes` cache in `.velody` (design D9); verify a test that an unchanged file (same size+mtime) is not re-hashed
- [x] 4.3 Make `scanSongsLibrary` skip dot-prefixed entries and merge the cloud index into `songs:list` with `sync`, `cloudId`, `sizeBytes`, `cloudOffline` (design D6); verify tests for the local/cloud/synced merge, no duplicates, and offline fallback
- [x] 4.4 Implement upload (hash → begin → PUT files 3-parallel → commit → push meta → write `cloudId`) on a `SerialTaskQueue` with `cloud:progress` events; verify tests with a fake client: success, resume skips uploaded files, failure leaves song local-only
- [x] 4.5 Implement atomic download into `.velody_dl_<id>` with size+hash verification and rename, startup cleanup of stale dirs, collision suffix (design D7); verify tests: success, hash mismatch discards, failure leaves no song folder
- [x] 4.6 Implement metadata sync on open (pull if newer, push if local newer, 2 s timeout falls back to local) (design D8); verify tests for each branch
- [x] 4.7 Implement `removeLocal` (push meta first, abort on failure, keep setlists) and `deleteEverywhere` (cloud first, local only on success, prune setlists); verify tests for both failure paths
- [x] 4.8 Expose `cloud:upload`, `cloud:uploadAll`, `cloud:download`, `cloud:removeLocal`, `cloud:deleteEverywhere`, `cloud:progress` in IPC/preload/types; verify `pnpm typecheck`

## 5. Renderer UI

- [x] 5.1 Add a Cloud settings section (URL, write-only token, enable toggle, Test connection, Upload all); verify manually in `pnpm dev` against the deployed Worker
- [x] 5.2 Add sync badges and per-state context actions to song list rows, plus offline indicator; verify a renderer test for which actions show per state
- [x] 5.3 Replace the delete confirmation for synced songs with "Remove from this laptop" vs "Delete everywhere" (explicit confirmation); verify a renderer test that cancel triggers no IPC call
- [x] 5.4 Opening a cloud-only song shows download progress, then loads it in `StemPlayer`; verify manually: remove a song locally, reopen it, it plays and keeps markers/trim

## 6. Docs

- [x] 6.1 Update CLAUDE.md and AGENTS.md (cloud is optional, local-first still holds, `src/main/cloud/`, `cloud-worker/`, `updatedAt`/`cloudId` in `.velody`); verify the described commands/paths exist
- [x] 6.2 Replace MOBILE_APP.md's Railway/Postgres/JWT backend section with the Worker API (design D4) and token auth; verify no remaining references to Railway as the planned backend

## 7. Integration check

- [ ] 7.1 End to end with the real Worker: upload all 103 songs, remove 3 locally (disk usage drops), reopen one (downloads and plays), edit its trim, delete one everywhere; then disable cloud and verify the app works offline with `pnpm test` and `pnpm build` green

## Workflow follow-up

- Archive the change with `/opsx:archive` after it's implemented and verified.
