# uptime-watch

External uptime probe for facesentry.com. Runs every ~10 minutes on GitHub Actions — deliberately OFF the product VPS — retry-confirms 60 seconds apart, and pages via Telegram only on a confirmed outage. A failed run in the Actions history = one confirmed-down observation.

Exists because a 100-minute 502 on 2026-08-04 paged nobody: every monitor lived on the same box as the product.

`keepalive.yml` commits a timestamp to `.keepalive` on the 1st and 15th of each month and switches the uptime workflow back on if it is off: GitHub switches off scheduled workflows in a public repository after 60 days without activity (it switched this probe off from 2026-10-09 to 2026-10-29).
