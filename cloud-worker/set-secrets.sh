#!/usr/bin/env bash
# Sets the Worker's 4 secrets. Asks for each value by name; nothing is stored
# in this file. API_TOKEN is generated here and printed once so you can save it.
set -euo pipefail
cd "$(dirname "$0")"

put() { printf '%s' "$2" | pnpm exec wrangler secret put "$1" >/dev/null && echo "✓ $1"; }

echo "Datos del token de R2 (R2 → Manage API tokens):"
read -rp "  Account ID (el número de https://ESTE.r2.cloudflarestorage.com): " account
read -rp "  Access Key ID: " key_id
read -rsp "  Secret Access Key (no se verá al pegar): " secret_key
echo

token=$(openssl rand -base64 48 | tr -d '\n')

put R2_ACCOUNT_ID "$account"
put R2_ACCESS_KEY_ID "$key_id"
put R2_SECRET_ACCESS_KEY "$secret_key"
put API_TOKEN "$token"

echo
echo "Listo. Tu API_TOKEN (guárdalo; va en Velody → Cloud sync → Token):"
echo "$token"
