# uptime-watch

External uptime watch for the sites on the product VPS, deliberately run OFF that VPS, paging via Telegram only on a confirmed outage.

Exists because a 100-minute 502 on 2026-08-04 paged nobody: every monitor lived on the same box as the product.

## Two layers

**1. Cloudflare Worker (`worker/`) — the main watch, every 2 minutes.** A Cron Trigger probes noticesent.com, dreamvibehq.com, meltpixels.com, relayzero.ai and facesentry.com (home page, HTTP 200 within 20 s). A site is paged as DOWN after 2 failed checks in a row, paged again every 30 minutes while it stays down, and once more when it recovers; one Telegram message per check covers every site that changed. All sites failing together adds a line that the server itself may be down. State lives in Workers KV, written only on a change plus a heartbeat at most every 10 minutes. `GET /status` on the Worker answers the age of its last stored run (no secrets). Probes send the user agent `MeltingPixels-uptime-watch/1.0 (...)`, so they are easy to tell apart in access logs.

- Logic: `worker/src/watch.ts` (pure, unit-tested: `npm test`); sites: `worker/src/sites.ts`; runtime: `worker/src/index.ts`.
- Checks: `npm run typecheck`, `npm test`, `npx wrangler deploy --dry-run`.
- Secrets (never in the repo): `npx wrangler secret put TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

**2. GitHub Actions (`.github/workflows/uptime.yml`) — the backstop.** Probes facesentry.com and noticesent.com, retry-confirms 60 seconds apart, and pages on a confirmed outage. Its schedule says every 10 minutes, but GitHub skips scheduled runs under load: it ran every 3-10 hours in October and November 2026, which is why the Worker exists. It also checks the Worker's `/status` (repository variable `WORKER_STATUS_URL`) and pages if the Worker's last run is more than 25 minutes old, so a stopped Worker does not fail silently.

`keepalive.yml` commits a timestamp to `.keepalive` on the 1st and 15th of each month and switches the uptime workflow back on if it is off: GitHub switches off scheduled workflows in a public repository after 60 days without activity (it switched this probe off from 2026-10-09 to 2026-10-29).
