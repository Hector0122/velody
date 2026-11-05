# Velody Cloud Worker

Personal cloud backend for Velody: a Cloudflare Worker over an R2 bucket
(stem files + synced `.velody` metadata) and a D1 database (song index).
Single user, one bearer token. The desktop app (and later the mobile app)
talk to it; R2 credentials live only here, as Worker secrets.

API contract: `../src/shared/cloud.ts`. Design:
`../openspec/changes/cloud-library-sync/design.md`.

## One-time setup

All commands from this folder (`cloud-worker/`).

```bash
pnpm install
pnpm exec wrangler login
```

1. **R2 bucket** — the config expects a bucket named `velody`:

   ```bash
   pnpm exec wrangler r2 bucket create velody   # skip if it already exists
   ```

2. **D1 database**:

   ```bash
   pnpm exec wrangler d1 create velody
   ```

   Copy the printed `database_id` into `wrangler.toml` (replacing
   `REPLACE_WITH_D1_DATABASE_ID`), then create the tables:

   ```bash
   pnpm migrate:remote
   ```

3. **R2 S3 credentials** (used only to sign upload/download URLs): Cloudflare
   dashboard → R2 → *Manage API tokens* → *Create API token* → permission
   **Object Read & Write**, scoped to the `velody` bucket. Note the Access Key
   ID, Secret Access Key, and your Account ID (shown on the R2 overview page).

4. **Secrets**:

   ```bash
   openssl rand -base64 48            # → your personal API token; keep it
   pnpm exec wrangler secret put API_TOKEN
   pnpm exec wrangler secret put R2_ACCOUNT_ID
   pnpm exec wrangler secret put R2_ACCESS_KEY_ID
   pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
   ```

5. **Deploy**:

   ```bash
   pnpm run deploy   # (plain `pnpm deploy` is a different pnpm command)
   ```

   Note the `https://velody-cloud.<subdomain>.workers.dev` URL it prints.

6. **Check**:

   ```bash
   curl -H "Authorization: Bearer <token>" https://velody-cloud.<subdomain>.workers.dev/v1/health
   # → {"ok":true}
   ```

Then in Velody: Cloud settings → paste the Worker URL and the token →
*Test connection* → enable.

## Day to day

| Task | Command |
|---|---|
| Run tests | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Local dev server | create `.dev.vars` with the four secrets (`KEY=value` lines, git-ignored), `pnpm migrate:local`, `pnpm dev` |
| Deploy changes | `pnpm run deploy` |
| Rotate the token | `pnpm exec wrangler secret put API_TOKEN`, then paste the new one in Velody's Cloud settings |
| New schema change | add `migrations/000N_*.sql`, `pnpm migrate:remote` |

## Costs

R2 free tier: 10 GB stored, no egress fees. Past that ≈ $0.015 / GB-month.
D1 and Workers usage for one person stays well inside the free tiers.
