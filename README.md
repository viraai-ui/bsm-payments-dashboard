# BSM Payments Dashboard

## Durable production storage

Payment JSON and private proof files never use the Vercel function filesystem. Storage is selected in this order:

1. Cloudflare R2, only when all of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` are non-empty.
2. A dedicated private GitHub data repository configured with `GITHUB_OWNER`, `GITHUB_TOKEN`, and `GITHUB_DATA_REPO`.
3. Local files only with `APP_LOCAL_ONLY=true`, or in non-production development outside Vercel.

A Vercel process with neither durable backend fails with a configuration error. `APP_LOCAL_ONLY` must never be enabled in Vercel.

### GitHub data-repository bootstrap

Create a **private, dedicated repository** (recommended name `bsm-payments-data`). It must not be the application repository, so runtime data commits cannot trigger application deployments. Bootstrap its default branch with:

```text
README.md
.gitignore
```

Suggested `README.md`: `Private runtime data for BSM Payments Dashboard. Do not connect this repository to Vercel.`
Suggested `.gitignore`: an empty/comment-only file. The application creates `data/*.json` and `proofs/<payment-id>/<uuid>.<ext>` via GitHub's Contents API as needed.

Set these production environment variables:

```dotenv
GITHUB_OWNER="viraai-ui"
GITHUB_TOKEN="<fine-grained token>"
GITHUB_DATA_REPO="bsm-payments-data"
GITHUB_DATA_BRANCH="main" # optional; omitted means the default branch
GITHUB_REPO="bsm-payments-dashboard" # legacy migration reads only
APP_LOCAL_ONLY="false"
```

The fine-grained token needs **Contents: Read and write** on the private data repository and **Contents: Read** on the legacy application repository during migration. `GITHUB_REPO` is never written by payment storage. On the first read of a missing JSON file, the application reads `data/<file>` from the legacy app repository; its first mutation creates the migrated document in `GITHUB_DATA_REPO`.

GitHub-backed proofs are limited to five files and 5 MiB per file. They are stored privately and returned only by authenticated/capability-checked application endpoints; no GitHub token or raw URL is exposed. R2 remains the preferred future backend and supports the existing 10 MiB proof limit.
# Payouts synchronization

The durable Payments → Payouts outbox is retried every minute by the Vercel Cron in `vercel.json`.
Production must define server-only `PAYOUTS_INTEGRATION_SECRET` and `CRON_SECRET`. Vercel sends
`Authorization: Bearer <CRON_SECRET>` to the cron route. Optionally set server-only
`PAYOUTS_BASE_URL` (for example `https://payouts.bsmindia.com`); otherwise the production Payouts
endpoint is used. `PAYOUTS_EVENTS_URL` remains available as an exact endpoint override. Never use
the `NEXT_PUBLIC_` prefix for any of these values.
