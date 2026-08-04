# uptime-watch

External uptime probe for facesentry.com. Runs every ~10 minutes on GitHub Actions — deliberately OFF the product VPS — retry-confirms 60 seconds apart, and pages via Telegram only on a confirmed outage. A failed run in the Actions history = one confirmed-down observation.

Exists because a 100-minute 502 on 2026-08-04 paged nobody: every monitor lived on the same box as the product.
